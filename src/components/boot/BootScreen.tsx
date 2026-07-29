import { motion } from "framer-motion";
import { BOOT_ITEMS } from "./bootConfig";
import {
  bootItemVariants,
  bootItemsStagger,
  bootScreenVariants,
  bootStatusVariants,
  bootTitleVariants,
} from "../../styles/motion";
import "./BootScreen.css";

export default function BootScreen() {
  return (
    <motion.div
      className="boot-screen"
      variants={bootScreenVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <motion.h1 className="boot-screen__title" variants={bootTitleVariants}>
        FRIDAY
      </motion.h1>

      <motion.p className="boot-screen__status" variants={bootStatusVariants}>
        Initializing...
      </motion.p>

      <motion.ul className="boot-screen__items" variants={bootItemsStagger}>
        {BOOT_ITEMS.map((item) => (
          <motion.li
            key={item}
            className="boot-screen__item"
            variants={bootItemVariants}
          >
            {item}
          </motion.li>
        ))}
      </motion.ul>
    </motion.div>
  );
}
