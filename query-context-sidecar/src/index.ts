import './polyfills';

import { registerAllBuildQueries } from './registry';
import { startServer } from './server';

registerAllBuildQueries();
startServer();
