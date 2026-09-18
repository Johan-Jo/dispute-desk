const router = {
  push(url: string) {
    window.dispatchEvent(new CustomEvent("test:navigate", { detail: url }));
  },
};

export const useRouter = () => router;
export const useSearchParams = () => new URLSearchParams(window.location.search);
