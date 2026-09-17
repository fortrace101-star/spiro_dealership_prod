import { db } from './src/db/database.ts';
import { getLocalSales, getSaleItems } from './src/db/repos.ts';

async function check() {
  await db.open();
  
  const products = await db.products.toArray();
  console.log('Local IndexedDB products:', products.length);
  console.log('Local product IDs:', products.slice(0, 20).map(p => p.id));
  
  const sales = await getLocalSales();
  console.log('Local pending sales:', sales.length);
  
  const allItems = [];
  for (const sale of sales) {
    const items = await getSaleItems(sale.id);
    allItems.push(...items);
  }
  
  console.log('Total sale item references:', allItems.length);
  
  // Find product references in sales that don't exist in local DB
  const localProductIds = new Set(products.map(p => p.id));
  const unknownRefs = allItems.filter(item => 
    item.product_id && 
    !localProductIds.has(item.product_id) && 
    /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(item.product_id)
  );
  
  console.log('Sale items referencing unknown products:', unknownRefs.length);
  if (unknownRefs.length > 0) {
    console.log('Unknown product examples:', unknownRefs.slice(0, 5).map(r => ({ name: r.name, productId: r.product_id })));
  }
  
  await db.close();
}

check().catch(console.error);

// Need to wait for async to complete
setTimeout(() => process.exit(0), 5000);