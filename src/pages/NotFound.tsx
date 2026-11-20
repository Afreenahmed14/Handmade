import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="container-x py-24 text-center">
      <h1 className="text-5xl text-walnut">Page not found</h1>
      <p className="mt-4 text-espresso/70">The page you're looking for doesn't exist or has moved.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-4"><Link to="/" className="btn-primary">Back to home</Link><Link to="/shop" className="btn-outline">Browse the collection</Link></div>
    </div>
  );
}
