"""
Drone Tactical Report Agent
MiroFish ReACT pattern: Plan → Search Zep → Analyze → Write.
Reports cite REAL facts from knowledge graph — no hallucination.
"""

import os
import json
from typing import Dict, Any, List
from graph_service import get_client, search_graph, get_graph_nodes


def gather_graph_intelligence(graph_id: str, mission_name: str) -> Dict[str, Any]:
    """
    ReACT Step 1: Gather intelligence from Zep knowledge graph.
    Multiple targeted queries to build comprehensive picture.
    """
    queries = [
        f"What drones were deployed in {mission_name}?",
        "What threats and dangers were identified?",
        "What victims or people needed rescue?",
        "What was the mission outcome and results?",
        "What risks and challenges were encountered?",
        "What routes and waypoints were used?",
    ]

    all_facts = []
    query_results = []
    for q in queries:
        result = search_graph(graph_id, q, limit=8)
        facts = result.get("facts", [])
        all_facts.extend(facts)
        query_results.append({"query": q, "facts_found": len(facts)})

    # Get graph nodes for entity summary
    nodes = get_graph_nodes(graph_id)
    node_names = [n.get("name", "") for n in nodes if n.get("name")]

    # Deduplicate facts
    unique_facts = list(dict.fromkeys(all_facts))

    return {
        "total_facts": len(unique_facts),
        "facts": unique_facts,
        "entities": node_names,
        "queries": query_results,
    }


def build_report_prompt(mission_state: Dict, intelligence: Dict, requirement: str) -> str:
    """Build ReACT-style prompt for report generation."""

    facts_text = "\n".join(f"  • {f}" for f in intelligence["facts"][:30])
    entities_text = ", ".join(intelligence["entities"][:20])

    phase = mission_state.get("phase", {})
    drones = mission_state.get("drones", [])
    active = [d for d in drones if d.get("status") != "ELIMINATED"]
    eliminated = [d for d in drones if d.get("status") == "ELIMINATED"]
    threats = mission_state.get("threats", [])
    victims = mission_state.get("victims", [])

    victims_text = ""
    if victims:
        for v in victims:
            victims_text += f"\n  - {v.get('name','')}: {v.get('people',0)} người, {v.get('priorityLabel','')}"

    return f"""Bạn là Sĩ quan Phân tích Chiến thuật của Quân đội Nhân dân Việt Nam.
Viết BÁO CÁO CHIẾN THUẬT dựa trên DỮ LIỆU THỰC từ knowledge graph (KHÔNG bịa thêm).

YÊU CẦU BÁO CÁO: {requirement}

DỮ LIỆU TỪ KNOWLEDGE GRAPH (Zep — facts thật):
{facts_text}

THỰC THỂ TRONG GRAPH: {entities_text}

TRẠNG THÁI NHIỆM VỤ:
- Nhiệm vụ: {mission_state.get('missionName', 'N/A')}
- Giai đoạn hiện tại: {phase.get('name', 'N/A')}
- Fleet: {len(active)} hoạt động, {len(eliminated)} bị loại
- Pin trung bình: {sum(d.get('battery',0) for d in active) / max(len(active),1):.0f}%
- Mối đe dọa: {len(threats)} ({', '.join(t.get('type','') for t in threats[:5])})
{f"- Nạn nhân: {victims_text}" if victims else ""}

HƯỚNG DẪN VIẾT:
1. Mỗi nhận định phải dựa trên fact từ knowledge graph (cite cụ thể)
2. Không bịa số liệu — chỉ dùng dữ liệu có trong graph
3. Viết bằng tiếng Việt, văn phong quân sự chuyên nghiệp
4. Cấu trúc: Tóm tắt → Phân tích tình huống → Đánh giá fleet → Rủi ro → Khuyến nghị

Trả về JSON (KHÔNG markdown):
{{
  "title": "Tiêu đề báo cáo",
  "summary": "Tóm tắt 2-3 câu",
  "sections": [
    {{
      "heading": "Tên mục",
      "content": "Nội dung chi tiết (cite facts từ graph)",
      "cited_facts": ["fact 1 được cite", "fact 2"]
    }}
  ],
  "risk_assessment": {{
    "level": "LOW|MEDIUM|HIGH|CRITICAL",
    "factors": ["Yếu tố rủi ro 1", "Yếu tố 2"]
  }},
  "recommendations": ["Khuyến nghị 1", "Khuyến nghị 2", "Khuyến nghị 3"],
  "facts_used": {len(intelligence['facts'])},
  "entities_referenced": {len(intelligence['entities'])}
}}"""


async def generate_report_async(
    graph_id: str,
    mission_state: Dict,
    requirement: str = "Báo cáo chiến thuật tổng hợp sau nhiệm vụ"
) -> Dict[str, Any]:
    """Generate tactical report using ReACT reasoning + Zep graph facts."""
    import httpx

    # Step 1: Gather intelligence from Zep
    intelligence = gather_graph_intelligence(graph_id, mission_state.get("missionName", ""))

    if not intelligence["facts"]:
        return {
            "error": "Không tìm thấy dữ liệu trong knowledge graph. Hãy build graph trước.",
            "intelligence": intelligence,
        }

    # Step 2: Build prompt with real facts
    prompt = build_report_prompt(mission_state, intelligence, requirement)

    # Step 3: Call LLM to reason and write report
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")

    async with httpx.AsyncClient(timeout=60) as client:
        if anthropic_key:
            try:
                resp = await client.post("https://api.anthropic.com/v1/messages", headers={
                    "x-api-key": anthropic_key, "anthropic-version": "2023-06-01", "Content-Type": "application/json",
                }, json={"model": "claude-sonnet-4-20250514", "max_tokens": 3000, "messages": [{"role": "user", "content": prompt}]})
                if resp.status_code == 200:
                    text = resp.json().get("content", [{}])[0].get("text", "{}")
                    text = text.replace("```json", "").replace("```", "").strip()
                    report = json.loads(text)
                    return {
                        "report": report,
                        "provider": "anthropic",
                        "intelligence_summary": {
                            "facts_gathered": intelligence["total_facts"],
                            "entities_found": len(intelligence["entities"]),
                            "queries_run": len(intelligence["queries"]),
                        },
                    }
            except Exception as e:
                print(f"Anthropic report error: {e}")

        if openai_key:
            try:
                resp = await client.post("https://api.openai.com/v1/chat/completions", headers={
                    "Authorization": f"Bearer {openai_key}", "Content-Type": "application/json",
                }, json={"model": "gpt-4o-mini", "max_tokens": 3000, "messages": [{"role": "user", "content": prompt}]})
                if resp.status_code == 200:
                    text = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "{}")
                    text = text.replace("```json", "").replace("```", "").strip()
                    report = json.loads(text)
                    return {
                        "report": report,
                        "provider": "openai",
                        "intelligence_summary": {
                            "facts_gathered": intelligence["total_facts"],
                            "entities_found": len(intelligence["entities"]),
                            "queries_run": len(intelligence["queries"]),
                        },
                    }
            except Exception as e:
                print(f"OpenAI report error: {e}")

    return {"error": "No LLM provider available"}


def generate_report(graph_id: str, mission_state: Dict, requirement: str = "Báo cáo chiến thuật tổng hợp") -> Dict:
    """Sync wrapper."""
    import asyncio
    return asyncio.run(generate_report_async(graph_id, mission_state, requirement))
