import '@shopify/ui-extensions';

//@ts-expect-error generated typings reference a module that may not resolve at lint time
declare module './src/Checkout.jsx' {
  const shopify: import('@shopify/ui-extensions/purchase.checkout.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}
