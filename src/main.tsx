import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "./components/common/ErrorBoundary";
import { CartProvider } from "./context/CartContext";
import { AuthProvider } from "./context/AuthContext";
import { StoreSettingsProvider } from "./context/StoreSettingsContext";
import "./index.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><ErrorBoundary><BrowserRouter><StoreSettingsProvider><AuthProvider><CartProvider><App /></CartProvider></AuthProvider></StoreSettingsProvider></BrowserRouter></ErrorBoundary></React.StrictMode>
);
