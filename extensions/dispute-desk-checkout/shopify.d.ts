import '@shopify/ui-extensions';

//@ts-expect-error — module declaration for .jsx file without a real source
declare module './src/Checkout.jsx' {
  const shopify: import('@shopify/ui-extensions/purchase.checkout.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}
