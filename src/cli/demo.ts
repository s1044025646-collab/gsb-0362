import { analyzePattern, expandTimeline, compareRotation } from '../core/siteswap.js';

function line(text = ''): void {
  process.stdout.write(text + '\n');
}

function title(text: string): void {
  line();
  line('═'.repeat(64));
  line(text);
  line('═'.repeat(64));
}

/** 完整中文演示：覆盖题目要求的全部典型模式与核对点。 */
export async function runDemo(): Promise<void> {
  line('Siteswap 周期抛接分析 · 中文演示');
  line('提醒：高度 h 的单位是“拍”，不是米；相位是节拍对周期取模的位置，不是球编号。');

  title('演示 1：3 —— 经典三球模式（长度 1）');
  const cascade = analyzePattern([3]);
  line(`合法：${cascade.valid}；球数：${cascade.ballCount}`);
  line(`映射：位置 0 高度 3 → 相位 ${cascade.mapping[0].landingPhase}`);
  line(`循环：[${cascade.cycles[0].phases.join(' → ')}]，球数 ${cascade.cycles[0].balls}`);

  title('演示 2：5,3,1 —— 合法三球模式（展示相位循环与各自球数）');
  const fiveThreeOne = analyzePattern([5, 3, 1]);
  line(`合法：${fiveThreeOne.valid}；高度和 ${fiveThreeOne.sum}，平均 ${fiveThreeOne.average}，球数 ${fiveThreeOne.ballCount}`);
  for (const entry of fiveThreeOne.mapping) {
    line(`  位置 ${entry.position}（高度 ${entry.height}） → 相位 ${entry.landingPhase}`);
  }
  for (const cycle of fiveThreeOne.cycles) {
    line(
      `  循环 [${cycle.phases.join(' → ')}] 高度 [${cycle.heights.join(',')}]，和 ${cycle.heightSum} = ${cycle.balls}×${fiveThreeOne.periodLength}，球数 ${cycle.balls}`,
    );
  }

  title('演示 3：5,3,1 有限节拍展开，核对稳定区间每拍至多一个真实落球');
  const expansion = expandTimeline([5, 3, 1], { startTime: 0, endTime: 11 });
  for (const event of expansion.events) {
    const detail =
      event.kind === 'landing' ? `（由 ${event.pairedTime} 拍抛出，相位 ${event.phase}）` : `（相位 ${event.phase}）`;
    line(`  t=${String(event.time).padStart(2)} ${event.kind === 'landing' ? '落下' : '抛出'} 来源位置 ${event.sourcePosition} 高度 ${event.height} ${detail}`);
  }
  line(`每拍至多一个真实落球：${expansion.atMostOneLandingPerBeat}`);
  line(`每拍落球数：${JSON.stringify(expansion.landingsPerBeat)}`);

  title('演示 4：含零的合法模式 5,0,1（0 表示该拍没有球可抛）');
  const withZero = analyzePattern([5, 0, 1]);
  line(`合法：${withZero.valid}；球数：${withZero.ballCount}`);
  for (const cycle of withZero.cycles) {
    line(
      `  循环 [${cycle.phases.join(' → ')}] 高度 [${cycle.heights.join(',')}]，球数 ${cycle.balls}${
        cycle.zeroFixedPoint ? '（零高度固定点，贡献 0 个球）' : ''
      }`,
    );
  }

  title('演示 5：3,2,1 —— 平均数是整数但落点冲突');
  const conflict = analyzePattern([3, 2, 1]);
  line(`合法：${conflict.valid}；平均高度 ${conflict.average}（整数仍不够）`);
  for (const reason of conflict.reasons) line(`  原因：${reason}`);
  for (const item of conflict.conflicts) {
    line(`  冲突相位 ${item.phase} 由原始位置 ${item.positions.join('、')} 贡献`);
  }
  line(`  未被覆盖的相位：${conflict.uncoveredPhases.join('、')}`);

  title('演示 6：全零 0,0,0 —— 合法的零球模式');
  const zeros = analyzePattern([0, 0, 0]);
  line(`合法：${zeros.valid}；球数：${zeros.ballCount}；循环数：${zeros.cycles.length}（全部零高度固定点）`);

  title('演示 7：最高高度边界 12（长度 1，合法单球“超高”模式）');
  const maxHeight = analyzePattern([12]);
  line(`合法：${maxHeight.valid}；球数：${maxHeight.ballCount}`);

  title('演示 8：重复周期与旋转等价（5,3,1 与旋转后的 3,1,5）');
  const repeated = compareRotation([5, 3, 1, 5, 3, 1], [5, 3, 1, 5, 3, 1]);
  line(`最小基本周期：${repeated.fundamentalPeriod}（块 [${repeated.fundamentalBlock.join(',')}]，重复 ${repeated.repetitions} 次）`);
  const rotation = compareRotation([5, 3, 1], [3, 1, 5]);
  line(`[5,3,1] 与 [3,1,5] 旋转等价：${rotation.rotationallyEquivalent}；偏移 offset=${rotation.offset}`);
  const notEquivalent = compareRotation([5, 3, 1], [4, 4, 1]);
  line(`[5,3,1] 与 [4,4,1] 旋转等价：${notEquivalent.rotationallyEquivalent}`);

  title('演示 9：非整数平均 4,1 —— 不合法但不是服务错误');
  const nonInteger = analyzePattern([4, 1]);
  line(`合法：${nonInteger.valid}；平均：${nonInteger.average}（5/2）`);
  line(`原因：${nonInteger.reasons[0]}`);

  title('演示 10：负起点区间与左边界在途事件（[3]，区间 [-2, 3]）');
  const negativeWindow = expandTimeline([3], { startTime: -2, endTime: 3 });
  for (const event of negativeWindow.events) {
    line(
      `  t=${event.time} ${event.kind === 'landing' ? '落下' : '抛出'} 位置 ${event.sourcePosition}${
        event.pairedTime !== undefined ? `（配对抛于 ${event.pairedTime}）` : ''
      }`,
    );
  }
  line(`区间开始前已在空中并在区间内落下的事件数：${negativeWindow.inFlightFromBefore}`);
  line(`每拍至多一个真实落球：${negativeWindow.atMostOneLandingPerBeat}`);

  title('演示 11：截断标记（[3]，区间 [0, 23]，仅允许 6 条事件）');
  const truncated = expandTimeline([3], { startTime: 0, endTime: 23, limitEvents: 6 });
  line(`实际返回事件数：${truncated.events.length}`);
  line(`因条数上限截断：${truncated.truncatedByLimit}`);
  line(`枚举覆盖到 t=${truncated.enumeratedThrough}（明确不假装完整展开）`);

  title('演示结束');
  line('CLI 可复现：node dist/src/cli/cli.js analyze [5,3,1]');
  line('API 文档与更多命令见 README.md。');
  await Promise.resolve();
}
