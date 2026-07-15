import { Link } from "react-router-dom";

const NotFound = () => {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground p-6">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Page not found</p>
        <Link to="/" className="text-primary underline hover:opacity-80">
          Return to Home
        </Link>
      </div>
    </main>
  );
};

export default NotFound;
