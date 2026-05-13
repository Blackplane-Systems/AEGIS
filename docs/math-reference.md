# AEGIS Math Reference

This document lists the implemented formulae implemented in code.

## Trust

- Composite trust: `T(d,t) = sum(w_i * phi_i(d,t))`, implemented in `TrustScoreEngine.compositeScore`.
- Temporal decay: `T(d,t) = T(d,t0) * exp(-lambda * delta_t)`, implemented in `TrustScoreEngine.decayScore`.
- Bayesian evidence mean: `alpha / (alpha + beta)`, implemented in `TrustScoreEngine.posteriorMean`.

## Health

- CUSUM upper statistic: `S+ = max(0, S+ + x - mu0 - k*sigma0)`.
- CUSUM lower statistic: `S- = max(0, S- + mu0 - x - k*sigma0)`.
- CUSUM alert threshold: `S+ > h*sigma0` or `S- > h*sigma0`.
- EWMA statistic: `z_n = lambda*x_n + (1-lambda)*z_(n-1)`.
- EWMA limits: `mu0 +/- L*sigma0*sqrt(lambda/(2-lambda) * (1 - (1-lambda)^(2n)))`.
- Drift score: `D(d,t) = 1 - exp(-sum(alpha_j * Delta_j(t)))`.
- Sensor trust feedback: `phi_sensor = 1 - D(d,t)`.

## Runtime Safety

- Discrete CBF: `h(x_next) >= (1 - alpha*delta_t) * h(x_now)`.
- CBF projection: one-dimensional bisection solves the closest safe `u*` satisfying the barrier constraint.
- Quorum gate: `q > (n + f) / 2`, implemented as `floor((n+f)/2)+1`.
- Firmware canary invariant: `|D_canary| >= max(30, 0.01*|D|)`.
- Health delta gate: `mean(T_post) - mean(T_pre) < -epsilon` halts rollout.
- Failure gate: `failures / stage_size > tau_fail` halts rollout.

## Analytics

- Granger F-statistic: `[(RSS_restricted - RSS_unrestricted)/p] / [RSS_unrestricted/(T - 2p - 1)]`.
- OLS: coefficients solve `(X^T X) beta = X^T y` via Gaussian elimination.
- Isolation Forest average path length: `c(psi) = 2H(psi-1) - 2(psi-1)/psi`, with `H(i)=ln(i)+0.5772156649`.
- Isolation score: `s(x, psi) = 2^(-E[h(x)] / c(psi))`.
- Kaplan-Meier survival: `S(t) = product_{t_i <= t}(1 - d_i/n_i)`.
- Log-rank statistic: `(O-E)^2 / V`, with one-degree chi-square p-value approximation.

## Simulation

- Gilbert-Elliott steady-state good probability: `pi_G = q/(p+q)`.
- Gilbert-Elliott loss probability: `pi_G*k + (1-pi_G)*h`.
- Twin fidelity: `F = 1 - (1/|S|) * sum_s(RMSE(twin_s, real_s) / range(real_s))`.

## Security and API

- Replay timestamp gate: `abs(t - now) < T_skew_tolerance`.
- Command sequence gate: `seq > last_accepted_seq(device)`.
- Ed25519 signatures cover stable JSON command, policy, audit block, and operator-token payloads.
