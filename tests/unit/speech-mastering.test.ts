import { describe, expect, it } from "vitest";
import { masterArgs, parseMeasure, passageStarts } from "@/server/speech/mastering";

describe("mastering the passages into a programme", () => {
  it("follows on with a breath between passages", () => {
    expect(passageStarts({ durations: [10, 5, 2], gapSeconds: 0.5 })).toEqual([0, 10.5, 16]);
    expect(passageStarts({ durations: [10, 5], placements: [0, 30] })).toEqual([0, 30]);
  });

  it("delays each passage to its start, mixes, normalises and fades", () => {
    const { args, totalSeconds } = masterArgs({ segments: ["/tmp/a.mp3", "/tmp/b.mp3"], durations: [10, 4], output: "/tmp/out.mp3", gapSeconds: 0.5, targetLufs: -16, metadata: { title: "Issue 5" } });
    expect(totalSeconds).toBeCloseTo(15.2, 2);
    expect(args.slice(0, 4)).toEqual(["-y", "-hide_banner", "-loglevel", "error"]);
    expect(args.filter((arg) => arg === "-i").length).toBe(2);
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,adelay=0|0[s0]");
    expect(graph).toContain("[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,adelay=10500|10500[s1]");
    expect(graph).toContain("[s0][s1]amix=inputs=2:normalize=0");
    expect(graph).toContain("loudnorm=I=-16:TP=-1.5:LRA=11");
    expect(graph).toContain("afade=t=out:st=14.400:d=0.8[out]");
    expect(args).toContain("-metadata");
    expect(args[args.indexOf("-metadata") + 1]).toBe("title=Issue 5");
    expect(args[args.length - 1]).toBe("/tmp/out.mp3");
  });

  it("places a film's passages at their scenes and ducks a bed under the voice", () => {
    const { args } = masterArgs({ segments: ["/tmp/a.mp3", "/tmp/b.mp3"], durations: [2, 2], output: "/tmp/out.mp3", placements: [0.3, 4.3], targetLufs: -14, music: { path: "/tmp/bed.mp3", levelDb: -20 } });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("adelay=300|300[s0]");
    expect(graph).toContain("adelay=4300|4300[s1]");
    expect(graph).toContain("[2:a]aformat");
    expect(graph).toContain("volume=-20dB");
    expect(graph).toContain("sidechaincompress");
    expect(graph).toContain("loudnorm=I=-14");
    expect(args).toContain("-stream_loop");
  });

  it("refuses a plan with a missing duration", () => {
    expect(() => masterArgs({ segments: ["/tmp/a.mp3"], durations: [], output: "/tmp/out.mp3" })).toThrow(/one duration per segment/);
  });

  it("reads length and level from what ffmpeg says", () => {
    const stderr = `Input #0, mp3, from 'x.mp3':\n  Duration: 00:00:03.45, start: 0.000000, bitrate: 128 kb/s\nsize=N/A time=00:00:01.20 bitrate=N/A speed=  50x\nsize=N/A time=00:00:03.42 bitrate=N/A speed=  60x\n[Parsed_volumedetect_0 @ 0x1] mean_volume: -21.3 dB\n[Parsed_volumedetect_0 @ 0x1] max_volume: -3.1 dB\n`;
    expect(parseMeasure(stderr)).toEqual({ durationSeconds: 3.42, meanVolumeDb: -21.3, maxVolumeDb: -3.1 });
    expect(parseMeasure("Duration: 00:01:02.50,").durationSeconds).toBe(62.5);
  });
});
