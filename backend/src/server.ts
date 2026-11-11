import { app } from './app';
import { env } from './config/env';
import { aiModels } from './ai/models';

// The models chosen in Settings → AI models; until they're read (or if that fails) the .env setup is used.
aiModels.load().catch((err) => console.error('Could not read the AI model settings, using .env:', (err as Error).message));

app.listen(env.port, () => {
  console.log(`Invoice OCR backend listening on http://localhost:${env.port}`);
});
