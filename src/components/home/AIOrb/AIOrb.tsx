import { motion } from "framer-motion";
import { type CSSProperties } from "react";
import { orbEntrance } from "../../../styles/motion";
import "./AIOrb.css";

export default function AIOrb() {
  const audioLevel = 0;

  return (
    <motion.div
      className="ai-orb"
      style={{ "--orb-audio": audioLevel } as CSSProperties}
      variants={orbEntrance}
    >
      <div className="ai-orb__glow" aria-hidden />
      <div className="ai-orb__fallback" aria-hidden>
        <span className="ai-orb__void" />
        <span className="ai-orb__rim ai-orb__rim--primary" />
        <span className="ai-orb__rim ai-orb__rim--broken" />
        <span className="ai-orb__rim ai-orb__rim--smoke" />
        <span className="ai-orb__clump ai-orb__clump--left" />
        <span className="ai-orb__clump ai-orb__clump--bottom" />
        <span className="ai-orb__powder ai-orb__powder--near" />
        <span className="ai-orb__powder ai-orb__powder--far" />
      </div>
    </motion.div>
  );
}
