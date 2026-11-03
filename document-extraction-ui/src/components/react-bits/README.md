# React Bits components

Source: https://github.com/DavidHDev/react-bits/tree/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-default/Animations

Vendored revision: `e12c22192ac7b4b452c5e2feb9b586d74765d696`. Components: StarBorder, AnimatedContent, FadeContent (TypeScript + CSS). License is preserved in LICENSE.md and included in the exported standalone HTML.

Local adaptation: useReducedMotion subscribes to system preference changes; StarBorder completely stops drawing in reduced-motion mode. AnimatedContent and FadeContent retain upstream scoped gsap.context cleanup. Application integrations use mount triggers so internal scrolling does not delay data display.
