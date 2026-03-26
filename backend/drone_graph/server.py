"""
Drone Graph API Server
Lightweight Flask server exposing Zep knowledge graph operations for DroneVerse.
Runs on port 5001 — Express proxy forwards /api/sim/* here.
"""

from flask import Flask, request, jsonify
import os
import json
import graph_service
import predict_service

app = Flask(__name__)


@app.route('/api/health')
def health():
    has_zep = bool(os.getenv("ZEP_API_KEY"))
    return jsonify({"status": "ok", "zep_configured": has_zep})


@app.route('/api/graph/build', methods=['POST'])
def build_graph():
    data = request.json
    if not data:
        return jsonify({"error": "JSON body required"}), 400

    mission = data.get("mission") or data
    graph_name = data.get("graph_name")
    result = graph_service.build_graph(mission, graph_name)
    return jsonify(result)


@app.route('/api/graph/search', methods=['POST'])
def search_graph():
    data = request.json
    graph_id = data.get("graph_id")
    query = data.get("query", "")
    if not graph_id:
        return jsonify({"error": "graph_id required"}), 400
    result = graph_service.search_graph(graph_id, query)
    return jsonify(result)


@app.route('/api/graph/nodes/<graph_id>')
def get_nodes(graph_id):
    nodes = graph_service.get_graph_nodes(graph_id)
    return jsonify({"graph_id": graph_id, "nodes": nodes, "count": len(nodes)})


@app.route('/api/predict', methods=['POST'])
def predict():
    """
    MiroFish Predictive Advisory — agents analyze situation and predict outcomes.
    Input: { missionState: {...}, whatIf: "Nếu gió tăng 25m/s?" }
    Output: { prediction: { agent_opinions: [...], consensus: {...} } }
    """
    data = request.json
    if not data:
        return jsonify({"error": "JSON body required"}), 400

    mission_state = data.get("missionState", {})
    what_if = data.get("whatIf", "Đánh giá tình huống hiện tại")

    result = predict_service.predict(mission_state, what_if)
    return jsonify(result)


if __name__ == '__main__':
    port = int(os.getenv("PORT", 5001))
    print(f"Drone Graph API on port {port}")
    app.run(host='0.0.0.0', port=port, debug=False)
