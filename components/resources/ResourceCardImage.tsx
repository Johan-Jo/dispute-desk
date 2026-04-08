import Image from "next/image";

type Props = {
  url: string | null | undefined;
  alt: string | null | undefined;
  /** Taller area for featured hub cards. */
  variant?: "default" | "featured";
};

/** Strip Pexels bounding-box params so the image is served at a usable width. */
function upgradePexelsUrl(url: string, targetW = 1200): string {
  if (!url.includes("images.pexels.com")) return url;
  try {
    const u = new URL(url);
    const currentW = parseInt(u.searchParams.get("w") ?? "0", 10);
    if (currentW > 0 && currentW < targetW) {
      u.searchParams.set("w", String(targetW));
      u.searchParams.delete("h");
      u.searchParams.delete("dpr");
    }
    return u.toString();
  } catch {
    return url;
  }
}

/** Thumbnail strip for resource hub listing cards (Estimate Pro `ResourceCardHero` pattern). */
export function ResourceCardImage({ url, alt, variant = "default" }: Props) {
  const frame =
    variant === "featured"
      ? "relative w-full h-64 overflow-hidden bg-slate-100 border-b"
      : "relative w-full aspect-[16/9] bg-slate-100 border-b";
  if (!url) {
    return (
      <div
        className={frame}
        style={{ borderColor: "rgba(15, 23, 42, 0.06)" }}
        aria-hidden
      />
    );
  }
  return (
    <div className={frame} style={{ borderColor: "rgba(15, 23, 42, 0.06)" }}>
      <Image
        src={upgradePexelsUrl(url)}
        alt={alt ?? ""}
        fill
        className="object-cover"
        sizes={
          variant === "featured"
            ? "(max-width: 768px) 100vw, 50vw"
            : "(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        }
      />
    </div>
  );
}
