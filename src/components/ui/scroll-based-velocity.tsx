"use client";

import React, { useEffect, useRef } from "react";
import {
    motion,
    useScroll,
    useSpring,
    useTransform,
    useMotionValue,
    useVelocity,
    useAnimationFrame,
    useReducedMotion,
    wrap,
} from "motion/react";
import { cn } from "@/lib/utils";

interface ScrollBasedVelocityProps {
    text: string;
    /** Optional second, counter-moving row. Omit it for a single line. */
    secondText?: string;
    /** Extra classes for the second row only (e.g. an outlined style). */
    secondClassName?: string;
    default_velocity?: number;
    /** Resting speed in screen pixels per second; keeps the pace identical at every screen size. */
    pixelsPerSecond?: number;
    className?: string;
    containerRef?: React.RefObject<HTMLElement | null>;
}

interface ParallaxProps {
    /** When true the row only moves at its base speed; gestures (wheel/swipe) are ignored. */
    still?: boolean;
    children: string;
    baseVelocity: number;
    /** Resting speed in screen pixels per second (sign = direction). Overrides baseVelocity's size. */
    pixelsPerSecond?: number;
    className?: string;
    containerRef?: React.RefObject<HTMLElement | null>;
}

function ParallaxText({ children, baseVelocity = 100, pixelsPerSecond, className, containerRef, still }: ParallaxProps) {
    const baseX = useMotionValue(0);
    // Total width of the moving strip, so a pixel speed can be converted to the %-based transform.
    const stripRef = useRef<HTMLDivElement>(null);
    const stripWidth = useRef(0);
    useEffect(() => {
        const el = stripRef.current;
        if (!el) return;
        const measure = () => { stripWidth.current = el.getBoundingClientRect().width; };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [children]);
    const { scrollY } = useScroll(containerRef ? { container: containerRef } : undefined);
    // The hero does not scroll, so wheel and swipe gestures also drive the velocity.
    const gestureY = useMotionValue(0);
    useEffect(() => {
        if (still) return;
        let lastTouchY: number | null = null;
        const onWheel = (e: WheelEvent) => gestureY.set(gestureY.get() + e.deltaY);
        const onTouchStart = (e: TouchEvent) => { lastTouchY = e.touches[0]?.clientY ?? null; };
        const onTouchMove = (e: TouchEvent) => {
            const y = e.touches[0]?.clientY;
            if (y === undefined || lastTouchY === null) return;
            gestureY.set(gestureY.get() + (lastTouchY - y));
            lastTouchY = y;
        };
        window.addEventListener("wheel", onWheel, { passive: true });
        window.addEventListener("touchstart", onTouchStart, { passive: true });
        window.addEventListener("touchmove", onTouchMove, { passive: true });
        return () => {
            window.removeEventListener("wheel", onWheel);
            window.removeEventListener("touchstart", onTouchStart);
            window.removeEventListener("touchmove", onTouchMove);
        };
    }, [gestureY, still]);
    const inputY = useTransform([scrollY, gestureY], ([a, b]: number[]) => (a ?? 0) + (b ?? 0));
    const scrollVelocity = useVelocity(inputY);
    const smoothVelocity = useSpring(scrollVelocity, {
        damping: 50,
        stiffness: 400,
    });
    const velocityFactor = useTransform(smoothVelocity, [0, 1000], [0, 5], {
        clamp: false,
    });

    /**
     * This is a magic wrapping for the length of the text - you
     * have to replace for wrapping that works for you or dynamically
     * calculate
     */
    const x = useTransform(baseX, (v) => `${wrap(-12.5, 0, v)}%`);
    const skewX = useTransform(smoothVelocity, [-1500, 0, 1500], still ? [0, 0, 0] : [-7, 0, 7], { clamp: true });

    const directionFactor = useRef<number>(1);
    useAnimationFrame((_t, delta) => {
        if (still) return;
        // Resting speed as a % of the strip per second. With pixelsPerSecond the pace is the same on every screen size.
        const restingPct =
            pixelsPerSecond !== undefined && stripWidth.current > 0
                ? (Math.abs(pixelsPerSecond) / stripWidth.current) * 100 * Math.sign(pixelsPerSecond)
                : baseVelocity;
        let moveBy = directionFactor.current * restingPct * (delta / 1000);

        /**
         * This is what changes the direction of the scroll once we
         * switch scrolling directions.
         */
        if (velocityFactor.get() < 0) {
            directionFactor.current = -1;
        } else if (velocityFactor.get() > 0) {
            directionFactor.current = 1;
        }

        moveBy += directionFactor.current * moveBy * velocityFactor.get();

        baseX.set(baseX.get() + moveBy);
    });

    return (
        <div className="overflow-hidden whitespace-nowrap flex flex-nowrap" style={{ width: '100%' }}>
            <motion.div
                ref={stripRef}
                className={cn("flex whitespace-nowrap", className)}
                style={{ x, skewX }}
            >
                {Array.from({ length: 8 }).map((_, i) => (
                    <span key={i} className="block mr-10 last:mr-10">{children}</span>
                ))}
            </motion.div>
        </div>
    );
}

export function ScrollBasedVelocity({
    text,
    secondText,
    secondClassName,
    default_velocity = 5,
    pixelsPerSecond,
    className,
    containerRef,
}: ScrollBasedVelocityProps) {
    const reduce = useReducedMotion() ?? false;
    return (
        // Decorative: screen readers get the text once via aria-label instead of 16 repeated copies.
        <section className="relative flex w-full flex-col gap-[0.28em]" role="img" aria-label={secondText ? `${text} ${secondText}` : text}>
            <ParallaxText baseVelocity={default_velocity} pixelsPerSecond={pixelsPerSecond} className={className} containerRef={containerRef} still={reduce}>
                {text}
            </ParallaxText>
            {secondText !== undefined && (
                <ParallaxText baseVelocity={-default_velocity} pixelsPerSecond={pixelsPerSecond === undefined ? undefined : -pixelsPerSecond} className={cn(className, secondClassName)} containerRef={containerRef} still={reduce}>
                    {secondText}
                </ParallaxText>
            )}
        </section>
    );
}
