# CasaLoom category product images update

The Shop All `Shop by category` tiles now prioritize the first published product image associated with each category (`products.categoryId === category.id`). The existing category image remains as a fallback when no product image is available.

No layout, CSS, navigation, filtering, order, payment, admin, or database behavior was changed.

If a category still shows its fallback image, confirm that at least one published product in that category has an image uploaded and that `getProducts()` returns its `imageUrl`.
