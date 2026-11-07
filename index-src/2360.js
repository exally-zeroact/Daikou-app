      if (typeof DaikomeSentryConfig !== 'undefined') {
        try {
          DaikomeSentryConfig.initSentry();
        } catch (e) {
          console.warn('[Sentry] init failed:', e.message);
        }
      }
