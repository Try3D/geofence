import "dotenv/config";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import healthRoutes from "./routes/health";
import exp01Routes from "./routes/exp-01";
import exp02Routes from "./routes/exp-02";
import exp03Routes from "./routes/exp-03";
import exp04Routes from "./routes/exp-04";
import exp05Routes from "./routes/exp-05";
import exp06Routes from "./routes/exp-06";
import exp07Routes from "./routes/exp-07";
import exp08Routes from "./routes/exp-08";
import exp09Routes from "./routes/exp-09";
import exp10Routes from "./routes/exp-10";
import exp11Routes from "./routes/exp-11";
import exp12Routes from "./routes/exp-12";
import exp14Routes from "./routes/exp-14";
import exp15Routes from "./routes/exp-15";
import exp16Routes from "./routes/exp-16";

const app = express();
app.use(express.json({ limit: "2mb" }));
const port = Number(process.env.PORT || 3000);

// Route registration
app.use("/health", healthRoutes);
app.use("/exp/01", exp01Routes);
app.use("/exp/02", exp02Routes);
app.use("/exp/03", exp03Routes);
app.use("/exp/04", exp04Routes);
app.use("/exp/05", exp05Routes);
app.use("/exp/06", exp06Routes);
app.use("/exp/07", exp07Routes);
app.use("/exp/08", exp08Routes);
app.use("/exp/09", exp09Routes);
app.use("/exp/10", exp10Routes);
app.use("/exp/11", exp11Routes);
app.use("/exp/12", exp12Routes);
app.use("/exp/14", exp14Routes);
app.use("/exp/15", exp15Routes);
app.use("/exp/16", exp16Routes);

// Error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message =
    err instanceof Error ? err.message : "Unexpected server error";
  res.status(500).json({ error: message });
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
