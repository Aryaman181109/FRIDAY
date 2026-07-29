import { motion } from "framer-motion";
import AIOrb from "../home/AIOrb/AIOrb";
import BrandTitle from "../home/BrandTitle";
import Greeting from "../home/Greeting";
import { heroStagger } from "../../styles/motion";
import "./HomeSurface.css";

export default function HomeSurface() {
  return (
    <motion.main className="home-surface" variants={heroStagger}>
      <div className="home-surface__hero">
        <AIOrb />
        <BrandTitle />
        <Greeting />
      </div>
    </motion.main>
  );
}
