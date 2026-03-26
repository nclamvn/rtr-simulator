"""
Drone Knowledge Graph Service
Adapts MiroFish GraphBuilder pattern for drone operations domain.
Uses Zep Cloud for persistent knowledge graph + agent memory.
"""

import os
import json
import uuid
import time
from typing import Dict, Any, List, Optional
from zep_cloud.client import Zep
from zep_cloud import EpisodeData

ZEP_API_KEY = os.getenv("ZEP_API_KEY", "")


def get_client():
    if not ZEP_API_KEY:
        raise ValueError("ZEP_API_KEY not set")
    return Zep(api_key=ZEP_API_KEY)


def mission_to_text(mission: Dict[str, Any]) -> str:
    """Convert mission JSON to narrative text for Zep graph ingestion."""
    lines = []
    name = mission.get("name", "Unknown Mission")
    domain = mission.get("domain", "MIL")
    desc = mission.get("desc", "")

    lines.append(f"Mission: {name} ({domain})")
    lines.append(f"Description: {desc}")

    # Drones
    drones = mission.get("drones", [])
    lines.append(f"\nFleet: {len(drones)} drones deployed")
    for d in drones:
        lines.append(f"- {d['id']} (type: {d['type']}) at position ({d.get('x',0)}, {d.get('y',0)}), altitude {d.get('alt',150)}m, heading {d.get('hdg',0)}°")

    # Threats
    threats = mission.get("threats", [])
    if threats:
        lines.append(f"\nThreats: {len(threats)} identified")
        for t in threats:
            lines.append(f"- {t.get('type','Unknown')} at ({t.get('x',0)}, {t.get('y',0)}), danger radius {t.get('radius',0)}m")

    # Waypoints
    waypoints = mission.get("waypoints", [])
    if waypoints:
        lines.append(f"\nWaypoints: {len(waypoints)} navigation points")
        for i, w in enumerate(waypoints):
            label = w.get("label", f"WP-{i+1}")
            lines.append(f"- {label}: ({w.get('x',0)}, {w.get('y',0)}), alt {w.get('alt',150)}m")

    # Victims (rescue missions)
    victims = mission.get("victims", [])
    if victims:
        lines.append(f"\nVictims: {len(victims)} groups identified")
        for v in victims:
            lines.append(f"- {v['name']}: {v['people']} people, priority {v.get('priority',3)} ({v.get('priorityLabel','')})")
            if v.get("detail"):
                lines.append(f"  Detail: {v['detail']}")

    # Phases
    phases = mission.get("phases", [])
    if phases:
        lines.append(f"\nMission Phases: {len(phases)}")
        for i, p in enumerate(phases):
            lines.append(f"- Phase {i+1}: {p.get('name','')} — {p.get('briefing','')}")
            for obj in p.get("objectives", []):
                if isinstance(obj, dict):
                    lines.append(f"  Objective: {obj.get('desc','')}")
                else:
                    lines.append(f"  Objective: {obj}")

    return "\n".join(lines)


def build_graph(mission: Dict[str, Any], graph_name: Optional[str] = None) -> Dict[str, Any]:
    """
    Build a Zep knowledge graph from mission data.

    Adapted from MiroFish GraphBuilderService.build_graph_async()
    """
    client = get_client()
    graph_id = graph_name or f"droneverse-{mission.get('id', uuid.uuid4().hex[:8])}"
    text = mission_to_text(mission)

    # Ensure user exists in Zep (user_id = graph namespace)
    try:
        client.user.add(user_id=graph_id)
    except Exception:
        pass  # User already exists

    # Add mission text to Zep graph (uses user_id as graph scope)
    try:
        result = client.graph.add(
            data=text,
            type="text",
            user_id=graph_id,
            source_description="DroneVerse mission data",
        )
    except Exception as e:
        return {"error": str(e), "graph_id": graph_id}

    # Wait for Zep async processing
    time.sleep(3)

    # Fetch graph stats
    try:
        nodes = list(client.graph.node.get_by_user_id(user_id=graph_id))
        edges = list(client.graph.edge.get_by_user_id(user_id=graph_id))

        node_types = {}
        for n in nodes:
            nt = getattr(n, 'entity_type', 'unknown') or 'entity'
            node_types[nt] = node_types.get(nt, 0) + 1

        return {
            "graph_id": graph_id,
            "status": "completed",
            "node_count": len(nodes),
            "edge_count": len(edges),
            "node_types": node_types,
            "nodes": [{"uuid": str(getattr(n, 'uuid', '')), "name": getattr(n, 'name', ''), "type": getattr(n, 'entity_type', '')} for n in nodes[:50]],
            "edges": [{"source": getattr(e, 'source_node_name', ''), "target": getattr(e, 'target_node_name', ''), "relation": getattr(e, 'relation', '')} for e in edges[:50]],
            "text_length": len(text),
        }
    except Exception as e:
        return {"graph_id": graph_id, "status": "processing", "message": str(e)}


def search_graph(graph_id: str, query: str, limit: int = 10) -> Dict[str, Any]:
    """Search the knowledge graph — adapted from MiroFish ZepTools."""
    client = get_client()
    try:
        results = client.graph.search(user_id=graph_id, query=query, limit=limit)
        facts = []
        for r in (results.edges if hasattr(results, 'edges') else []):
            fact = getattr(r, 'fact', '') or f"{getattr(r, 'source_node_name', '')} → {getattr(r, 'relation', '')} → {getattr(r, 'target_node_name', '')}"
            facts.append(fact)
        return {"query": query, "facts": facts, "count": len(facts)}
    except Exception as e:
        return {"query": query, "error": str(e), "facts": []}


def get_graph_nodes(graph_id: str) -> List[Dict]:
    """Get all nodes in a graph."""
    client = get_client()
    try:
        nodes = list(client.graph.node.get_by_user_id(user_id=graph_id))
        return [{"uuid": str(getattr(n, 'uuid', '')), "name": getattr(n, 'name', ''), "type": getattr(n, 'entity_type', ''), "summary": getattr(n, 'summary', '')} for n in nodes]
    except Exception as e:
        return [{"error": str(e)}]


if __name__ == "__main__":
    # Test with sample mission
    test_mission = {
        "id": "test",
        "name": "Test Rescue Mission",
        "domain": "RESCUE",
        "desc": "3 drones rescue 20 people from flood",
        "drones": [
            {"id": "HERA-01", "type": "HERA-S", "x": 0, "y": 0, "alt": 150, "hdg": 45},
            {"id": "HERA-C1", "type": "HERA-C", "x": 10, "y": 0, "alt": 100, "hdg": 45},
        ],
        "threats": [{"type": "Flood zone", "x": 200, "y": 150, "radius": 80}],
        "waypoints": [{"x": 200, "y": 150, "alt": 120, "label": "Rescue point Alpha"}],
        "victims": [{"name": "Village A", "people": 20, "priority": 1, "priorityLabel": "CRITICAL", "detail": "Trapped by rising water"}],
    }

    print("Mission text:")
    print(mission_to_text(test_mission))
    print("\nBuilding graph...")
    result = build_graph(test_mission)
    print(json.dumps(result, indent=2, ensure_ascii=False))
