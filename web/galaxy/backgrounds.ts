import bgIndigo from "@/assets/bg/bg-indigo.jpg";
import bgIndigoSm from "@/assets/bg/bg-indigo-sm.jpg";
import bgNebula from "@/assets/bg/bg-nebula.jpg";
import bgNebulaSm from "@/assets/bg/bg-nebula-sm.jpg";
import bgPlum from "@/assets/bg/bg-plum.jpg";
import bgPlumSm from "@/assets/bg/bg-plum-sm.jpg";
import bgViolet from "@/assets/bg/bg-violet.jpg";
import bgVioletSm from "@/assets/bg/bg-violet-sm.jpg";

export interface SkyBackground {
  name: string;
  src: string;
  /** 1280px variant small screens pick via srcSet — a quarter of the
      full-size decode cost. */
  srcSm: string;
}

/**
 * Hand-painted gouache starfields generated in the exact style of the
 * user's reference posters — dense candy stars, sparkle crosses, spiral
 * swirls and comets over deep purple skies.
 */
export const BACKGROUNDS: SkyBackground[] = [
  { name: "Violet Sky", src: bgViolet, srcSm: bgVioletSm },
  { name: "Indigo Night", src: bgIndigo, srcSm: bgIndigoSm },
  { name: "Plum Dusk", src: bgPlum, srcSm: bgPlumSm },
  { name: "Nebula Drift", src: bgNebula, srcSm: bgNebulaSm },
];
