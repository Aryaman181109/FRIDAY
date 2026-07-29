import { motion } from "framer-motion";
import Clock from "../home/Clock";
import CommandDock from "./CommandDock";
import HomeSurface from "./HomeSurface";
import {
  appShellVariants,
  fadeInClock,
} from "../../styles/motion";
import "./AppShell.css";

export default function AppShell() {
  return (
    <motion.div
      className="app-shell"
      initial="hidden"
      animate="visible"
      variants={appShellVariants}
    >
        <motion.div
          className="app-shell__top-left"
          variants={fadeInClock}
        >
          <Clock />
        </motion.div>
        <motion.div
          className="app-shell__status"
          variants={fadeInClock}
          aria-hidden
        >
          <span className="app-shell__signal">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span className="app-shell__status-dot" />
          <span className="app-shell__status-divider" />
          <span className="app-shell__status-text">FRIDAY ONLINE</span>
          <span className="app-shell__status-pulse" />
        </motion.div>
        <HomeSurface />
        <CommandDock />
    </motion.div>
  );
}
