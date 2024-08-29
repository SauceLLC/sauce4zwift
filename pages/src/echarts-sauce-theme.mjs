
const staticTheme = {
    color: ["#c12e34", "#e6b600", "#0098d9", "#2b821d", "#005eaa", "#339ca8", "#cda819", "#32a487"],
    backgroundColor: "rgba(0,0,0,0)",
    textStyle: {
        overflow: 'truncate',
        ellipsis: '…',
        fontFamily: 'Saira',
        fontSize: '1em',
    },
    label: {
        color: '#fffc',
        textBorderColor: 'transparent',
        textBorderWidth: 0,
    },
    endLabel: {
        color: '#fffc',
        textBorderColor: '#000c',
        textBorderWidth: 2,
    },
    title: {
        textStyle: {
            color: "rgba(255,255,255,0.92)",
            fontSize: '1em',
        },
        subtextStyle: {color: "rgba(255,255,255,0.8)"}
    },
    line: {
        itemStyle: {borderWidth: 0},
        lineStyle: {width: 1.5},
        symbolSize: 6,
        symbol: "emptyCircle",
        smooth: false
    },
    bar: {
        itemStyle: {
            barBorderWidth: 0,
            barBorderColor: "rgba(255,255,255,0.74)"
        }
    },
    pie: {
        itemStyle: {
            borderWidth: 0,
            borderColor: "rgba(255,255,255,0.74)"
        }
    },
    parallel: {
        itemStyle: {
            borderWidth: 0,
            borderColor: "rgba(255,255,255,0.74)"
        }
    },
    gauge: {
        itemStyle: {
            borderWidth: 0,
            borderColor: "rgba(255,255,255,0.74)"
        },
        splitLine: {lineStyle: {color: '#fffa'}},
        axisLabel: {
            color: '#fffa',
            fontSize: '0.6em',
        },
        detail: {
            color: '#fffc',
            fontSize: '2em',
        },
    },
    graph: {
        itemStyle: {
            borderWidth: 0,
            borderColor: "rgba(255,255,255,0.74)"
        },
        lineStyle: {
            width: 1,
            color: "#aaaaaa"
        },
        symbolSize: 6,
        symbol: "emptyCircle",
        smooth: false,
        color: ["#c12e34", "#e6b600", "#0098d9", "#2b821d", "#005eaa", "#339ca8", "#cda819", "#32a487"],
        label: {color: "#ffffff"}
    },
    categoryAxis: {
        axisLine: {
            show: true,
            lineStyle: {
                color: "rgba(255,255,255,0.5)"
            }
        },
        axisTick: {
            show: true,
            lineStyle: {
                color: "rgba(255,255,255,0.25)"
            }
        },
        axisLabel: {
            show: true,
            color: "rgba(255,255,255,0.8)"
        },
        splitLine: {
            show: false,
            lineStyle: {color: ["#ccc"]}
        },
        splitArea: {
            show: false,
            areaStyle: {color: ["rgba(250,250,250,0.3)", "rgba(200,200,200,0.3)"]}
        }
    },
    valueAxis: {
        axisLine: {
            show: true,
            lineStyle: {color: "rgba(255,255,255,0.5)"}
        },
        axisTick: {
            show: true,
            lineStyle: {color: "rgba(255,255,255,0.25)"}
        },
        axisLabel: {
            show: true,
            color: "rgba(255,255,255,0.8)"
        },
        splitLine: {
            show: true,
            lineStyle: {color: ["rgba(255,255,255,0.25)"]}
        },
        splitArea: {
            show: false,
            areaStyle: {color: ["rgba(250,250,250,0.3)", "rgba(200,200,200,0.3)"]}
        }
    },
    toolbox: {
        iconStyle: {borderColor: "rgba(255,255,255,0.8)"},
        emphasis: {iconStyle: {borderColor: "#ffffff"}}
    },
    legend: {textStyle: {color: "#fffe"}},
    tooltip: {
        padding: 4,
        axisPointer: {
            lineStyle: {
                color: "rgba(255,255,255,0.68)",
                width: 1.5
            },
            crossStyle: {
                color: "rgba(255,255,255,0.68)",
                width: 2
            }
        }
    },
    visualMap: {
        color: ["#1790cf", "#a2d4e6"]
    },
    markLine: {
        lineStyle: {color: '#fffc'},
        label: {
            fontWeight: 700,
            distance: 2,
            fontSize: '0.76em',
            color: '#fff',
            textShadowColor: '#000',
            textShadowBlur: 2,
        },
    },
    markPoint: {
        label: {color: "#ffffff"},
        emphasis: {label: {color: "#ffffff"}}
    }
};


export function cssColor(key, shade=0, alpha=1) {
    return `hsla(
        var(--theme-${key}-hue),
        var(--theme-${key}-sat),
        calc(var(--theme-${key}-light) + (${shade * 100}% * var(--theme-${key}-shade-dir))),
        ${alpha * 100}%)`;
}


export function getTheme(mode='static', options) {
    if (mode === 'static') {
        return staticTheme;
    } else if (mode === 'dynamic') {
        return genDynamicTheme(options);
    } else if (mode === 'dynamic-alt') {
        return genDynamicTheme({fg: 'fg-alt', bg: 'bg-alt', ...options});
    } else {
        throw new TypeError('Invalid theme mode');
    }
}


function genDynamicTheme({fg='fg', bg='bg'}={}) {
    const theme = JSON.parse(JSON.stringify(staticTheme));
    return Object.assign(theme, {
        label: {
            color: cssColor(fg, 0, 0.80),
            fontWeight: 600,
            fontSize: '0.8em',
            textBorderColor: 'transparent',
            textBorderWidth: 0,
        },
        endLabel: {
            color: cssColor(fg, 0, 0.80),
            fontWeight: 600,
            fontSize: '0.6em',
            textBorderColor: cssColor(fg, 1, 0.80),
            textBorderWidth: 2,
        },
        title: {
            textStyle: {
                color: cssColor(fg, 0, 0.92),
                fontSize: '1em',
            },
            subtextStyle: {color: cssColor(fg, 0, 0.8)}
        },
        bar: {
            itemStyle: {
                barBorderWidth: 0,
                barBorderColor: cssColor(fg, 0, 0.74),
            }
        },
        pie: {
            itemStyle: {
                borderWidth: 0,
                borderColor: cssColor(fg, 0, 0.74),
            },
        },
        parallel: {
            itemStyle: {
                borderWidth: 0,
                borderColor: cssColor(fg, 0, 0.74),
            }
        },
        gauge: {
            itemStyle: {
                borderWidth: 0,
                borderColor: cssColor(fg, 0, 0.74),
            },
            splitLine: {lineStyle: {color: cssColor(fg, 0, 0.3)}},
            axisLabel: {
                color: cssColor(fg, 0, 0.9),
                fontSize: '0.6em',
            },
            detail: {
                color: cssColor(fg, 0, 2/3),
                fontSize: '2em',
            },
        },
        graph: {
            itemStyle: {
                borderWidth: 0,
                borderColor: cssColor(fg, 0, 0.74),
            },
            lineStyle: {
                width: 1,
                color: cssColor(fg, 1/3),
            },
            symbolSize: 6,
            symbol: 'emptyCircle',
            smooth: false,
            color: ["#c12e34", "#e6b600", "#0098d9", "#2b821d", "#005eaa", "#339ca8", "#cda819", "#32a487"],
            label: {color: cssColor(fg)}
        },
        categoryAxis: {
            axisLine: {
                show: true,
                lineStyle: {color: cssColor(fg, 0, 0.5)}
            },
            axisTick: {
                show: true,
                lineStyle: {color: cssColor(fg, 0, 0.25)}
            },
            axisLabel: {
                show: true,
                color: cssColor(fg, 0, 0.8),
                fontSize: '0.7em',
                fontWeight: 600,
                margin: 12,
            },
            splitLine: {
                show: false,
                lineStyle: {color: [cssColor(fg, 0.8)]}
            },
            splitArea: {
                show: false,
                areaStyle: {color: [cssColor(fg, 0.2, 0.3), cssColor(fg, 0.22, 0.3)]}
            }
        },
        valueAxis: {
            axisLine: {
                show: true,
                lineStyle: {color: cssColor(fg, 0, 0.5)},
            },
            axisTick: {
                show: true,
                lineStyle: {color: cssColor(fg, 0, 0.25)},
            },
            axisLabel: {
                show: true,
                color: cssColor(fg, 0, 0.8),
                fontSize: '0.7em',
                fontWeight: 600,
                margin: 12,
            },
            splitLine: {
                show: true,
                lineStyle: {color: cssColor(fg, 0, 0.10)},
            },
            splitArea: {
                show: false,
                areaStyle: {
                    color: ["rgba(250,250,250,0.3)", "rgba(200,200,200,0.3)"]
                }
            }
        },
        timeAxis: {
            axisLine: {
                show: true,
                lineStyle: {color: cssColor(fg, 0, 0.5)},
            },
            axisTick: {
                show: true,
                lineStyle: {color: cssColor(fg, 0, 0.25)},
            },
            axisLabel: {
                show: true,
                color: cssColor(fg, 0, 0.8),
                fontSize: '0.7em',
                fontWeight: 600,
                margin: 12,
            },
            splitLine: {
                show: true,
                lineStyle: {color: cssColor(fg, 0, 0.10)},
            },
            splitArea: {
                show: false,
                areaStyle: {
                    color: ["rgba(250,250,250,0.3)", "rgba(200,200,200,0.3)"]
                }
            }
        },
        toolbox: {
            iconStyle: {borderColor: cssColor(fg, 0.1, 0.8)},
            emphasis: {iconStyle: {borderColor: cssColor(fg, 0.1, 1)}},
        },
        legend: {textStyle: {color: cssColor(fg, 0.1, 0.92)}},
        tooltip: {
            confine: true,
            backgroundColor: cssColor(fg, 0.9, 0.86),
            borderColor: cssColor(fg, 0.1, 0.5),
            textStyle: {
                color: cssColor(fg, 0),
            },
            padding: 10
        },
        axisPointer: {
            lineStyle: {
                color: cssColor(fg, 0, 0.90),
                width: 1
            },
            crossStyle: {
                color: cssColor(fg, 0, 0.84),
                width: 2
            }
        },
        visualMap: {color: ["#1790cf", "#a2d4e6"]},
        markLine: {
            lineStyle: {
                color: cssColor(fg, 0, 0.7),
                cap: 'round',
            },
            label: {
                fontWeight: 600,
                fontFamily: 'inherit',
                distance: 2,
                fontSize: '0.76em',
                color: cssColor(fg, 0, 1),
                textBorderColor: cssColor(fg, 1, 0.8),
                textBorderWidth: 1,
                textShadowColor: cssColor(fg, 1, 0.4),
                textShadowBlur: 4,
            },
        },
        markPoint: {
            label: {color: cssColor(fg)},
            emphasis: {label: {color: cssColor(fg)}}
        }
    });
}
