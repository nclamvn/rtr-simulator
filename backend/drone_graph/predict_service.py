"""
Drone Predictive Advisory Service
MiroFish-inspired: agents with personality + memory analyze situation and predict outcomes.
This is an ADVISORY layer — does NOT replace SwarmController physics simulation.
"""

import os
import json
from typing import Dict, Any, List, Optional

from graph_service import get_client, search_graph

LLM_API_KEY = os.getenv("ANTHROPIC_API_KEY") or os.getenv("OPENAI_API_KEY", "")

# Drone agent personas (adapted from MiroFish OasisProfileGenerator)
DRONE_PERSONAS = {
    "HERA-S": {
        "role": "Trinh sát viên",
        "personality": "Thận trọng, quan sát tốt, ưu tiên an toàn fleet. Có kinh nghiệm bay trong điều kiện gió mạnh.",
        "expertise": "Trinh sát, đánh giá tình huống, phát hiện nguy hiểm sớm",
        "risk_tolerance": "low",
    },
    "HERA-C": {
        "role": "Vận chuyển viên",
        "personality": "Đáng tin cậy, ổn định, luôn tính toán tải trọng và pin. Lo lắng khi gió mạnh vì tải nặng.",
        "expertise": "Vận chuyển hàng, tính toán route tối ưu, quản lý pin",
        "risk_tolerance": "very_low",
    },
    "VEGA-X": {
        "role": "Chiến đấu viên",
        "personality": "Quyết đoán, chiến thuật, sẵn sàng chấp nhận rủi ro để hoàn thành nhiệm vụ.",
        "expertise": "Hộ tống, đánh chặn, tấn công, bảo vệ fleet",
        "risk_tolerance": "high",
    },
    "BOGEY": {
        "role": "Đối thủ",
        "personality": "Khó đoán, linh hoạt, tìm điểm yếu của fleet.",
        "expertise": "Xâm nhập, né tránh, tấn công bất ngờ",
        "risk_tolerance": "medium",
    },
}


def build_prediction_prompt(mission_state: Dict, what_if: str, zep_facts: List[str], drone_profiles: List[Dict]) -> str:
    """Build prompt for LLM to generate multi-agent predictions."""

    profiles_text = ""
    for dp in drone_profiles:
        persona = DRONE_PERSONAS.get(dp.get("type", "HERA-S"), DRONE_PERSONAS["HERA-S"])
        profiles_text += f"""
Drone {dp['id']} ({dp['type']} — {persona['role']}):
  Vị trí: ({dp.get('x',0):.0f}, {dp.get('y',0):.0f}), alt {dp.get('alt',0):.0f}m
  Pin: {dp.get('battery',100):.0f}% | Tốc độ: {dp.get('speed',0):.1f}m/s
  Tính cách: {persona['personality']}
  Chuyên môn: {persona['expertise']}
  Chấp nhận rủi ro: {persona['risk_tolerance']}
"""

    facts_text = "\n".join(f"- {f}" for f in zep_facts[:15]) if zep_facts else "Chưa có dữ liệu từ knowledge graph."

    phase = mission_state.get("phase", {})
    threats = mission_state.get("threats", [])

    return f"""Bạn là hệ thống phân tích chiến thuật drone đa tác nhân (Multi-Agent Tactical Advisory).

TÌNH HUỐNG HIỆN TẠI:
- Nhiệm vụ: {mission_state.get('missionName', 'Unknown')}
- Giai đoạn: {phase.get('name', 'N/A')} — {phase.get('briefing', '')}
- Fleet: {len(drone_profiles)} drone hoạt động
- Thời tiết: Gió {mission_state.get('windSpeed', 0)}m/s hướng {mission_state.get('windDir', 0)}°
- Mối đe dọa: {', '.join(t.get('type','') for t in threats) or 'Không'}

DRONE PROFILES:
{profiles_text}

KIẾN THỨC TỪ GRAPH (Zep Memory):
{facts_text}

CÂU HỎI WHAT-IF: {what_if}

Hãy phân tích theo cấu trúc sau (trả về JSON thuần, KHÔNG markdown):
{{
  "agent_opinions": [
    {{
      "drone_id": "HERA-01",
      "opinion": "Ý kiến ngắn gọn của drone này dựa trên tính cách + kinh nghiệm (1-2 câu tiếng Việt)",
      "risk_level": "low|medium|high|critical",
      "recommendation": "Khuyến nghị cụ thể (1 câu)"
    }}
  ],
  "consensus": {{
    "success_probability": 75,
    "risk_factors": ["Yếu tố rủi ro 1", "Yếu tố rủi ro 2"],
    "recommended_actions": ["Hành động 1", "Hành động 2", "Hành động 3"],
    "summary": "Tóm tắt dự đoán chung (2-3 câu tiếng Việt)"
  }}
}}"""


async def predict_async(mission_state: Dict, what_if: str) -> Dict[str, Any]:
    """Generate predictions using LLM + Zep memory — async version."""
    import httpx

    graph_id = mission_state.get("graphId")
    zep_facts = []

    # Query Zep for relevant knowledge
    if graph_id and what_if:
        search_result = search_graph(graph_id, what_if, limit=10)
        zep_facts = search_result.get("facts", [])

    # Build drone profiles from state
    drones = mission_state.get("drones", [])
    profiles = []
    for d in drones:
        if d.get("status") == "ELIMINATED":
            continue
        profiles.append({
            "id": d.get("id", ""),
            "type": d.get("typeKey", d.get("type", "HERA-S")),
            "x": d.get("x", 0),
            "y": d.get("y", 0),
            "alt": d.get("alt", 150),
            "battery": d.get("battery", 100),
            "speed": d.get("speed", 0),
        })

    prompt = build_prediction_prompt(mission_state, what_if, zep_facts, profiles)

    # Call LLM (Anthropic preferred, OpenAI fallback)
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")

    async with httpx.AsyncClient(timeout=30) as client:
        # Try Anthropic
        if anthropic_key:
            try:
                resp = await client.post("https://api.anthropic.com/v1/messages", headers={
                    "x-api-key": anthropic_key, "anthropic-version": "2023-06-01", "Content-Type": "application/json",
                }, json={"model": "claude-sonnet-4-20250514", "max_tokens": 1500, "messages": [{"role": "user", "content": prompt}]})
                if resp.status_code == 200:
                    data = resp.json()
                    text = data.get("content", [{}])[0].get("text", "{}")
                    text = text.replace("```json", "").replace("```", "").strip()
                    return {"prediction": json.loads(text), "provider": "anthropic", "zep_facts_used": len(zep_facts)}
            except Exception as e:
                print(f"Anthropic predict error: {e}")

        # Fallback OpenAI
        if openai_key:
            try:
                resp = await client.post("https://api.openai.com/v1/chat/completions", headers={
                    "Authorization": f"Bearer {openai_key}", "Content-Type": "application/json",
                }, json={"model": "gpt-4o-mini", "max_tokens": 1500, "messages": [{"role": "user", "content": prompt}]})
                if resp.status_code == 200:
                    data = resp.json()
                    text = data.get("choices", [{}])[0].get("message", {}).get("content", "{}")
                    text = text.replace("```json", "").replace("```", "").strip()
                    return {"prediction": json.loads(text), "provider": "openai", "zep_facts_used": len(zep_facts)}
            except Exception as e:
                print(f"OpenAI predict error: {e}")

    return {"error": "No LLM provider available", "prediction": None}


def predict(mission_state: Dict, what_if: str) -> Dict[str, Any]:
    """Sync wrapper for predict_async."""
    import asyncio
    return asyncio.run(predict_async(mission_state, what_if))
