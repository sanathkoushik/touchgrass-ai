import { createApp } from './app'
import { MemoryRepository } from './repository'

// Stage 5: in-memory storage (per Worker instance, lost on restart). Stage 6 swaps in MongoDB Atlas.
const app = createApp({ repo: new MemoryRepository() })

export default app
