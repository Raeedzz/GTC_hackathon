import { buildColdStartPrompt, buildIterativePrompt } from '@/lib/prompts';
import { scorePlan } from '@/lib/damageModel';

export const maxDuration = 60;

export async function POST(request) {
  const scenario = await request.json();
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OpenRouter API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data) {
        controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
      }

      let bestPlan = null;
      let bestScore = -Infinity;
      const history = [];
      const totalRounds = 10;
      const plansPerRound = 5;

      try {
        for (let round = 0; round < totalRounds; round++) {
          send({ type: 'round_start', round, total: totalRounds });

          const prompt = round === 0
            ? buildColdStartPrompt(scenario)
            : buildIterativePrompt(scenario, bestPlan, bestScore, history);

          let plans = [];
          try {
            plans = await callNemotron(apiKey, prompt);
          } catch (err) {
            send({ type: 'error', round, message: 'AI call failed: ' + err.message });
            continue;
          }

          if (!Array.isArray(plans) || plans.length === 0) {
            send({ type: 'error', round, message: 'No valid plans returned' });
            continue;
          }

          for (let i = 0; i < plans.length; i++) {
            const plan = plans[i];
            const score = scorePlan(plan, scenario);

            history.push({
              round,
              plan_id: plan.plan_id || i + 1,
              strategy: plan.strategy_name || `Plan ${i + 1}`,
              score,
            });

            if (score > bestScore) {
              bestScore = score;
              bestPlan = plan;
            }

            send({
              type: 'plan_evaluated',
              round,
              plan_index: i,
              plan_name: plan.strategy_name || `Plan ${i + 1}`,
              score,
              best_so_far: bestScore,
            });
          }

          send({
            type: 'round_complete',
            round,
            best_score: bestScore,
            best_strategy: bestPlan?.strategy_name || 'Unknown',
            plans_evaluated: history.length,
          });
        }

        send({
          type: 'complete',
          optimal_plan: bestPlan,
          best_score: bestScore,
          total_plans_evaluated: history.length,
          history,
          improvement_curve: buildImprovementCurve(history, totalRounds),
        });
      } catch (err) {
        send({ type: 'fatal_error', message: err.message });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
    },
  });
}

async function callNemotron(apiKey, prompt) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://wildfire-recovery-sim.vercel.app',
      'X-Title': 'Wildfire Recovery Simulator',
    },
    body: JSON.stringify({
      model: 'nvidia/llama-3.3-nemotron-super-49b-v1:free',
      messages: [
        {
          role: 'system',
          content: 'You are a disaster recovery planning AI. You output ONLY valid JSON arrays of recovery plans. No markdown, no explanations, no code blocks. Just the raw JSON array.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 4000,
    }),
  });

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Empty response from AI');
  }

  // Parse JSON from response - handle markdown code blocks
  let jsonStr = content.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Try to find JSON array in response
    const match = jsonStr.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Could not parse AI response as JSON');
  }
}

function buildImprovementCurve(history, totalRounds) {
  const curve = [];
  for (let r = 0; r < totalRounds; r++) {
    const roundPlans = history.filter(h => h.round === r);
    if (roundPlans.length === 0) continue;
    const bestInRound = Math.max(...roundPlans.map(p => p.score));
    curve.push({ round: r, best_score: bestInRound });
  }
  return curve;
}
