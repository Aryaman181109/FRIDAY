import { motion } from "framer-motion";
import { useGreeting } from "../../hooks/useGreeting";
import { fadeInGreeting } from "../../styles/motion";
import "./Greeting.css";

interface GreetingProps {
  name?: string;
}

export default function Greeting({ name = "Aryaman" }: GreetingProps) {
  const greeting = useGreeting(name);

  return (
    <motion.p className="greeting" variants={fadeInGreeting}>
      {greeting}
    </motion.p>
  );
}
