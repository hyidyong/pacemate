import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PaceMate",
    short_name: "PaceMate",
    description: "학업 로드맵과 상담을 관리하는 PaceMate",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#FAFDFC",
    theme_color: "#6BCB77",
    lang: "ko",
  };
}
