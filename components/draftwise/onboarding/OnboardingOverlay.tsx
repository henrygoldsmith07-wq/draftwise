"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface OnboardingStep {
  id: string;
  targetSelector: string;
  title: string;
  description: React.ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  nextAction?: string;
  skipable?: boolean;
}

interface OnboardingOverlayProps {
  isOpen: boolean;
  onComplete: () => void;
  steps: OnboardingStep[];
  persistKey?: string;
}

const DEFAULT_POSITION = "bottom" as const;
const STORAGE_KEY = "draftwise_onboarding_complete";

export function OnboardingOverlay({ 
  isOpen, 
  onComplete, 
  steps,
  persistKey = STORAGE_KEY
}: OnboardingOverlayProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [showSkipConfirmation, setShowSkipConfirmation] = useState(false);

  const currentStep = steps[currentStepIndex];
  const isLastStep = currentStepIndex === steps.length - 1;
  const isFirstStep = currentStepIndex === 0;

  // Skip confirmation timer
  useEffect(() => {
    if (showSkipConfirmation) {
      const timer = setTimeout(() => setShowSkipConfirmation(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [showSkipConfirmation]);

  const handleNext = () => {
    if (isLastStep) {
      localStorage.setItem(persistKey, "true");
      onComplete();
    } else {
      setCurrentStepIndex((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  const handleSkip = () => {
    if (currentStep.skipable !== false) {
      if (currentStep.skipable === true || !isFirstStep) {
        setShowSkipConfirmation(true);
      } else {
        localStorage.setItem(persistKey, "true");
        onComplete();
      }
    }
  };

  const handleSkipConfirm = () => {
    localStorage.setItem(persistKey, "true");
    onComplete();
  };

  if (!isOpen) return null;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={() => {}}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{currentStep.title}</DialogTitle>
            <DialogDescription>
              <div className="onboarding-description">{currentStep.description}</div>
            </DialogDescription>
          </DialogHeader>
          
          {/* Progress indicator */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-muted-foreground">
              Step {currentStepIndex + 1} of {steps.length}
            </span>
            <div className="flex gap-1">
              {steps.map((_, idx) => (
                <div
                  key={idx}
                  className={`h-1 rounded-full transition-all ${
                    idx === currentStepIndex
                      ? "w-6 bg-primary"
                      : idx < currentStepIndex
                      ? "w-3 bg-primary/50"
                      : "w-3 bg-muted"
                  }`}
                />
              ))}
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="ghost" onClick={handleSkip}>
              {showSkipConfirmation ? "Are you sure?" : "Skip"}
            </Button>
            
            {!isFirstStep && (
              <Button variant="outline" onClick={handleBack}>
                Back
              </Button>
            )}
            
            <Button onClick={handleNext}>
              {isLastStep ? "Let's go!" : "Next"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Overlay highlight effect could be added here targeting specific elements */}
    </>
  );
}

// Default onboarding steps
export const DEFAULT_ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    targetSelector: ".brand-lockup",
    title: "Your writing, your privacy",
    description: (
      <>
        Draftwise stores everything locally in your browser. No accounts, no cloud uploads unless you explicitly choose AI assistance with your own API keys.
      </>
    ),
    position: "bottom",
    skipable: false,
  },
  {
    id: "dashboard",
    targetSelector: ".document-grid",
    title: "Start anywhere",
    description: (
      <>
        Create new drafts, import .txt or .md files, or try the sample to see analysis in action. Your documents live only on this device.
      </>
    ),
    position: "top",
    skipable: true,
  },
  {
    id: "review",
    targetSelector: "[data-review-guard]",
    title: "Review one suggestion at a time",
    description: (
      <>
        Use Tab to navigate suggestions, Enter to accept, Backspace to ignore. Watch your draft improve line by line. Nothing changes until you decide.
      </>
    ),
    position: "top",
    skipable: true,
  },
  {
    id: "shortcuts",
    targetSelector: '.rail-button[aria-label*="Shortcuts"]',
    title: "Keep hands on the keyboard",
    description: (
      <>
        Press ? anytime to see shortcuts. Ctrl+Enter accepts all visible suggestions instantly. Arrow keys move between issues.
      </>
    ),
    position: "left",
    skipable: true,
  },
  {
    id: "goals",
    targetSelector: ".rail-goal",
    title: "Tailor to your audience",
    description: (
      <>
        Set audience, intent, and tone. Draftwise adapts suggestions based on your goals—academic essays need different feedback than casual emails.
      </>
    ),
    position: "right",
    skipable: true,
  },
];
