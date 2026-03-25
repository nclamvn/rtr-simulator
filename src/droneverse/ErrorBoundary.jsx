import { Component } from "react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary] ${this.props.name || "Component"}:`, error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: 20, background: "#0a0a0a", color: "#ff3b5c", fontFamily: "monospace", fontSize: 13, textAlign: "center" }}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>⚠️ {this.props.name || "Component"} — Lỗi</div>
          <div style={{ color: "#90b0d0", fontSize: 11, marginBottom: 12, maxWidth: 300 }}>{this.state.error?.message || "Unexpected error"}</div>
          <button onClick={() => this.setState({ hasError: false, error: null })} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #ff3b5c40", background: "#ff3b5c15", color: "#ff3b5c", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>Thử lại</button>
        </div>
      );
    }
    return this.props.children;
  }
}
