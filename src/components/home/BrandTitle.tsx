import { motion } from "framer-motion";
import { fadeInBrand } from "../../styles/motion";
import "./BrandTitle.css";

export default function BrandTitle() {
  return (
    <motion.h1 className="brand-title" variants={fadeInBrand}>
      FRIDAY
    </motion.h1>
  );
}
