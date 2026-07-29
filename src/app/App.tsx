import { AnimatePresence, motion } from "framer-motion";
import "../styles/globals.css";
import Providers from "./providers";
import BootScreen from "../components/boot/BootScreen";
import AISetupGate from "../features/ai/AISetupGate";
import { useBootComplete } from "../hooks/useBootComplete";
import { homeEnterVariants } from "../styles/motion";

export default function App() {
  const bootComplete = useBootComplete();

  return (
    <Providers>
      <AnimatePresence mode="wait">
        {!bootComplete ? (
          <BootScreen key="boot" />
        ) : (
          <motion.div
            key="home"
            className="app-root"
            variants={homeEnterVariants}
            initial="hidden"
            animate="visible"
          >
            <AISetupGate />
          </motion.div>
        )}
      </AnimatePresence>
    </Providers>
  );
}
