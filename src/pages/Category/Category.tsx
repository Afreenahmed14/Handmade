import { Link, useParams } from "react-router-dom";
import ProductCard from "../../components/products/ProductCard";
import ProductArt from "../../components/common/ProductArt";
import { useCatalog } from "../../hooks/useCatalog";

export default function CategoryPage() {
  const { slug = "" } = useParams();
  const { categories, products, loading, error } = useCatalog();
  const category = categories.find((item) => item.slug === slug);
  const items = category ? products.filter((product) => product.categoryId === category.id) : [];

  return (
    <section className="container-x mx-auto max-w-[1320px] py-9 md:py-12">
      {loading && <p role="status" className="py-12 text-center text-walnut/70">Loading category...</p>}
      {error && <p role="alert" className="py-12 text-center text-red-800">{error}</p>}
      {!loading && !error && !category && <div className="py-16 text-center"><h1 className="text-4xl text-walnut">Category not found</h1><Link to="/shop" className="btn-primary mt-6">Browse the collection</Link></div>}
      {!loading && !error && category && <>
        <div className="grid items-center gap-8 border-b border-brass/40 pb-8 md:grid-cols-[minmax(0,1fr)_16rem]">
          <div><Link to="/shop" className="text-sm text-walnut underline underline-offset-4">All pieces</Link><h1 className="mt-3 text-4xl text-walnut">{category.name}</h1>{category.description && <p className="mt-3 max-w-2xl text-espresso/75">{category.description}</p>}</div>
          {category.imageUrl ? <img src={category.imageUrl} alt={category.name} className="aspect-square w-full object-cover" /> : <ProductArt kind={category.art} className="aspect-square w-full" />}
        </div>
        {!items.length ? <p className="py-12 text-center text-walnut/70">There are no published pieces in this category yet.</p> : <div className="mt-8 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">{items.map((product) => <ProductCard key={product.id} p={product} />)}</div>}
      </>}
    </section>
  );
}