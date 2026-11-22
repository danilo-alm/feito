import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Feito",
    short_name: "Feito",
    description: "Your personal tasks, on this installation.",
    lang: "en",
    start_url: "/hoje",
    display: "standalone",
    background_color: "#F6F4EF",
    theme_color: "#F6F4EF",
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
