import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// 不用 StrictMode：开发模式下 effect 双触发会创建两个 xterm 实例
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
