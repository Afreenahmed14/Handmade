import { Link, useParams } from "react-router-dom";
export default function Stub({ title, phase }: { title: string; phase: string }) {
  const { slug } = useParams();
  return (
    <div className="container-x py-24 text-center">
      <h1 className="text-5xl text-walnut">{title}{slug ? `: ${slug}` : ""}</h1>
      <p className="mt-4 text-espresso/70">This page is built in {phase}.</p>
      <Link to="/" className="btn-primary mt-8">Back to home</Link>
    </div>
  );
}
