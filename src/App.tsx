import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/theme/ThemeProvider";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

// The editor is a single-screen app. Production Nginx answers unknown paths
// with a real 404 page; this fallback only covers dev/preview servers that
// rewrite every path to index.html. A router dependency is not worth its
// attack surface for one route.
const isEditorPath = (pathname: string): boolean =>
  pathname === "/" || pathname === "/index.html";

const App = () => (
  <ErrorBoundary>
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        <Sonner />
        {isEditorPath(window.location.pathname) ? <Index /> : <NotFound />}
      </TooltipProvider>
    </ThemeProvider>
  </ErrorBoundary>
);

export default App;
