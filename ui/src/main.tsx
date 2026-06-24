import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { MobileApp } from "./MobileApp";
import "./styles.css";
import "./mobile.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {import.meta.env.VITE_MOBILE_MODE === "true" ? <MobileApp /> : <App />}
  </StrictMode>,
);
