import React, { useEffect, useRef, useState } from 'react';
import './splash.css';

const steps = [
  {
    title: 'Create Your Organization',
    description:
      'Start by setting up your organization. This will be the central hub for managing all your push notification projects. Choose a name that represents your brand or company.',
    label: 'Step 1',
  },
  {
    title: 'Add Your First Project',
    description:
      'Now, add your first push notification campaign. Organize your notifications by brand, platform, or target audience. You can manage multiple campaigns under one organization.',
    label: 'Step 2',
  },
  {
    title: 'Set Up Your Channels',
    description:
      "Choose the communication channels you'd like to use for your push notifications—whether it's Web, Android, iOS, Email, or Messenger. Simply integrate the provided code snippet into your app or website to start sending notifications.",
    label: 'Step 3',
  },
];

const Splash = ({ onDone }) => {
  const [index, setIndex] = useState(0);
  const timerRef = useRef(null);

  // Auto-advance slides from right to left.
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setIndex((i) => (i + 1) % steps.length);
    }, 3500);
    return () => clearInterval(timerRef.current);
  }, []);

  // Move to the Domain screen after hitting Continue.
  const handleFinish = () => {
    // Trigger navigation back to App, which then routes to Domain.jsx.
    if (onDone) onDone();
  };

  return (
    <div className="splash">
      <div className="splash-header">
        <button type="button" className="text-btn" onClick={handleFinish}>
          Skip
        </button>
      </div>

      <div className="splash-body">
        <div className="splash-card">
          <div className="slides-wrapper">
            <div className="slides" style={{ transform: `translateX(-${index * 100}%)` }}>
              {steps.map((step) => (
                <div className="slide" key={step.title}>
                  <div className="step-label">{step.label}</div>
                  <h1>{step.title}</h1>
                  <p>{step.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="splash-footer">
            <div className="dots">
              {steps.map((_, i) => (
                <span key={i} className={`dot ${i === index ? 'active' : ''}`} />
              ))}
            </div>
            <div className="controls">
              {/* Only show Continue on the final step to proceed to Domain.jsx */}
              {index === steps.length - 1 && (
                <button type="button" className="primary-btn" onClick={handleFinish}>
                  Continue
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Splash;
