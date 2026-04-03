import Image from "next/image";

type Props = {
  url: string;
  alt: string;
  /** Full width under marketing header; fixed height (Figma BlogArticleView). */
  fullBleed?: boolean;
};

export function ArticleHeroImage({ url, alt, fullBleed }: Props) {
  if (fullBleed) {
    return (
      <div className="relative w-full h-64 md:h-96 overflow-hidden bg-gray-200">
        <Image
          src={url}
          alt={alt}
          fill
          className="object-cover"
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
        src={url}
        alt={alt}
        fill
        className="object-cover"
        priority
        sizes="(max-width: 900px) 100vw, 840px"
      />
    </div>
  );
}
