import 'dotenv/config';
import app from './app.js';

const port = process.env.PORT || 5000;
// Keep authentication available during database outages. Data routes and the
// readiness endpoint check the database when requested.
app.listen(port, () => console.log(`JMS Textiles API listening on port ${port}`));
