import Image from "next/image";

type Props = {
  url: string;
  alt: string;
  /** Full width under marketing header; fixed height (Figma BlogArticleView). */
  fullBleed?: boolean;
};

/**
 * Upgrades Pexels URLs that were stored with a small w= parameter (e.g. w=940 from the
 * "large" preset) to a higher resolution so Next.js image optimisation doesn't have to
 * upscale them on retina screens.
 */
function upgradePexelsUrl(url: string, targetW = 1920): string {
  if (!url.includes("images.pexels.com")) return url;
  try {
    const u = new URL(url);
    const currentW = parseInt(u.searchParams.get("w") ?? "0", 10);
    if (currentW > 0 && currentW < targetW) {
      u.searchParams.set("w", String(targetW));
      u.searchParams.delete("dpr");
    }
    return u.toString();
  } catch {
    return url;
  }
}

export function ArticleHeroImage({ url, alt, fullBleed }: Props) {
  const src = upgradePexelsUrl(url);
  if (fullBleed) {
    return (
      <div className="relative w-full h-64 md:h-96 overflow-hidden bg-gray-200">
        <Image
          src={src}
          alt={alt}
          fill
          style={{ objectFit: "cover" }}
          priority
          sizes="100vw"
        />
      </div>
    );
  }
  return (
    <div
      className="relative w-full aspect-[2/1] max-h-[420px] mb-10 rounded-2xl overflow-hidden bg-slate-100 border shadow-sm"
      style={{ borderColor: "rgba(15, 23, 42, 0.08)" }}
    >
      <Image
        src={src}
        alt={alt}
        fill
        style={{ objectFit: "cover" }}
        priority
        sizes="(max-width: 900px) 100vw, 840px"
      />
    </div>
  );
}
