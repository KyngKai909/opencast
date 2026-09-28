// The Results area's routes: where it aired, airings with proof, codes, statements, redeeming.

import { Route } from "react-router";
import Airings from "./Airings";
import Code from "./Code";
import Redeem from "./Redeem";
import Results from "./Results";
import Statement from "./Statement";

export const resultsBusinessRoutes = (
  <>
    <Route path="results" element={<Results />} />
    <Route path="results/airings" element={<Airings />} />
    <Route path="results/airings/:asRunId" element={<Airings />} />
    <Route path="results/codes/:code" element={<Code />} />
    <Route path="balance/statements/:statementId" element={<Statement />} />
    <Route path="redeem" element={<Redeem />} />
  </>
);
