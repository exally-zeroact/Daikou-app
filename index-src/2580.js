      if (typeof DaikomeOpenReplayConfig !== 'undefined') {
        try {
          DaikomeOpenReplayConfig.initOpenReplay();
        } catch (e) {
          console.warn('[OpenReplay] init error:', e.message);
        }
      }
