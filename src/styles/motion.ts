import type { Transition, Variants } from "framer-motion";

/** Apple-style deceleration — primary easing curve */
export const easePremium = [0.22, 1, 0.36, 1] as const;

/** Soft settle for large surfaces and app launch */
export const easeSoft = [0.16, 1, 0.3, 1] as const;

/** Gentle symmetric curve for hover states */
export const easeInOut = [0.65, 0, 0.35, 1] as const;

export const transitionPremium: Transition = {
  duration: 0.55,
  ease: easePremium,
};

export const transitionSoft: Transition = {
  duration: 0.85,
  ease: easeSoft,
};

export const transitionHover: Transition = {
  duration: 0.5,
  ease: easePremium,
};

/** App shell: fade + top-level stagger */
export const appShellVariants: Variants = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: {
      duration: 1.35,
      ease: easeSoft,
      when: "beforeChildren",
      staggerChildren: 0.2,
      delayChildren: 0.45,
    },
  },
};

/** Hero group: orb → title → greeting */
export const heroStagger: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.16,
      delayChildren: 0.08,
    },
  },
};

export const fadeInClock: Variants = {
  hidden: {
    opacity: 0,
    y: -8,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.95,
      ease: easePremium,
    },
  },
};

export const orbEntrance: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.93,
  },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 1.15,
      ease: easeSoft,
    },
  },
};

export const fadeInBrand: Variants = {
  hidden: {
    opacity: 0,
    y: 14,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 1.05,
      ease: easePremium,
    },
  },
};

export const fadeInGreeting: Variants = {
  hidden: {
    opacity: 0,
    y: 10,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.95,
      ease: easePremium,
    },
  },
};

export const fadeUpCommand: Variants = {
  hidden: {
    opacity: 0,
    y: 10,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.9,
      ease: easeSoft,
      delay: 0.2,
    },
  },
};

export const commandBarHover: Variants = {
  rest: {
    y: 0,
    scale: 1,
    transition: transitionHover,
  },
  hover: {
    y: -4,
    scale: 1.004,
    transition: transitionHover,
  },
  tap: {
    y: 0,
    scale: 0.998,
    transition: { duration: 0.2, ease: easePremium },
  },
};

/** Boot screen entrance sequence */
export const bootScreenVariants: Variants = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.6,
      ease: easeSoft,
      when: "beforeChildren",
      staggerChildren: 0.18,
      delayChildren: 0.08,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: 0.75,
      ease: easeSoft,
    },
  },
};

export const bootTitleVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 10,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.85,
      ease: easePremium,
    },
  },
};

export const bootStatusVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 6,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.75,
      ease: easePremium,
    },
  },
};

export const bootItemsStagger: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.26,
      delayChildren: 0.12,
    },
  },
};

export const bootItemVariants: Variants = {
  hidden: {
    opacity: 0,
    x: -6,
  },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.65,
      ease: easePremium,
    },
  },
};

export const homeEnterVariants: Variants = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.85,
      ease: easeSoft,
      delay: 0.08,
    },
  },
};

export const commandBarLiftTransition: Transition = {
  duration: 0.5,
  ease: easePremium,
};

export const responsePanelVariants: Variants = {
  hidden: {
    opacity: 0,
    y: "var(--response-panel-hidden-y)",
    scale: 0.98,
  },
  visible: {
    opacity: 1,
    y: "var(--response-panel-visible-y)",
    scale: 1,
    transition: {
      duration: 0.65,
      ease: easePremium,
      delay: 0.05,
    },
  },
  exit: {
    opacity: 0,
    y: "var(--response-panel-hidden-y)",
    scale: 0.98,
    transition: {
      duration: 0.4,
      ease: easePremium,
    },
  },
};

/** @deprecated use specific variants above */
export const appLaunch = appShellVariants;
export const launchStagger = appShellVariants;
export const homeStagger = heroStagger;
export const fadeUp = fadeInBrand;
export const fadeIn = fadeInClock;
export const easeOut = easePremium;
