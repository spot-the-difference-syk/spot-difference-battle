
import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import { PuzzleCatalogProvider } from "./features/catalog/puzzle-catalog";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(<PuzzleCatalogProvider><App /></PuzzleCatalogProvider>);
