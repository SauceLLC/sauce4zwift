export const theme = {
    "color": [
        "#c12e34",
        "#e6b600",
        "#0098d9",
        "#2b821d",
        "#005eaa",
        "#339ca8",
        "#cda819",
        "#32a487"
    ],
    "backgroundColor": "rgba(0,0,0,0)",
    "textStyle": {
        overflow: 'truncate',
        ellipsis: '…',
        fontFamily: 'Jost',  // inherit only works for svg
        fontSize: '1em',
    },
    label: {
        color: '#fffc',
        textBorderColor: 'transparent',
        textBorderWidth: 0,
    },
    "title": {
        "textStyle": {
            "color": "rgba(255,255,255,0.92)",
            fontSize: '1em',
        },
        "subtextStyle": {
            "color": "rgba(255,255,255,0.8)"
        }
    },
    "line": {
        "itemStyle": {
            "borderWidth": "0"
        },
        "lineStyle": {
            "width": 1.5
        },
        "symbolSize": "6",
        "symbol": "emptyCircle",
        "smooth": false
    },
    "bar": {
        "itemStyle": {
            "barBorderWidth": "0",
            "barBorderColor": "rgba(255,255,255,0.74)"
        }
    },
    "pie": {
        "itemStyle": {
            "borderWidth": "0",
            "borderColor": "rgba(255,255,255,0.74)"
        }
    },
    "parallel": {
        "itemStyle": {
            "borderWidth": "0",
            "borderColor": "rgba(255,255,255,0.74)"
        }
    },
    "sankey": {
        "itemStyle": {
            "borderWidth": "0",
            "borderColor": "rgba(255,255,255,0.74)"
        }
    },
    "funnel": {
        "itemStyle": {
            "borderWidth": "0",
            "borderColor": "rgba(255,255,255,0.74)"
        }
    },
    "gauge": {
        "itemStyle": {
            "borderWidth": "0",
            "borderColor": "rgba(255,255,255,0.74)"
        },
        splitLine: {
            lineStyle: {
                color: '#fffa',
            }
        },
        axisLabel: {
            color: '#fffa',
            fontSize: '0.6em',
        },
        detail: {
            color: '#fffc',
            fontSize: '2em',
        },
    },
    "candlestick": {
        "itemStyle": {
            "color": "#c12e34",
            "color0": "#2b821d",
            "borderColor": "#c12e34",
            "borderColor0": "#2b821d",
            "borderWidth": 1
        }
    },
    "graph": {
        "itemStyle": {
            "borderWidth": "0",
            "borderColor": "rgba(255,255,255,0.74)"
        },
        "lineStyle": {
            "width": 1,
            "color": "#aaaaaa"
        },
        "symbolSize": "6",
        "symbol": "emptyCircle",
        "smooth": false,
        "color": [
            "#c12e34",
            "#e6b600",
            "#0098d9",
            "#2b821d",
            "#005eaa",
            "#339ca8",
            "#cda819",
            "#32a487"
        ],
        "label": {
            "color": "#ffffff"
        }
    },
    "categoryAxis": {
        "axisLine": {
            "show": true,
            "lineStyle": {
                "color": "rgba(255,255,255,0.5)"
            }
        },
        "axisTick": {
            "show": true,
            "lineStyle": {
                "color": "rgba(255,255,255,0.25)"
            }
        },
        "axisLabel": {
            "show": true,
            "color": "rgba(255,255,255,0.8)"
        },
        "splitLine": {
            "show": false,
            "lineStyle": {
                "color": [
                    "#ccc"
                ]
            }
        },
        "splitArea": {
            "show": false,
            "areaStyle": {
                "color": [
                    "rgba(250,250,250,0.3)",
                    "rgba(200,200,200,0.3)"
                ]
            }
        }
    },
    "valueAxis": {
        "axisLine": {
            "show": true,
            "lineStyle": {
                "color": "rgba(255,255,255,0.5)"
            }
        },
        "axisTick": {
            "show": true,
            "lineStyle": {
                "color": "rgba(255,255,255,0.25)"
            }
        },
        "axisLabel": {
            "show": true,
            "color": "rgba(255,255,255,0.8)"
        },
        "splitLine": {
            "show": true,
            "lineStyle": {
                "color": [
                    "rgba(255,255,255,0.25)"
                ]
            }
        },
        "splitArea": {
            "show": false,
            "areaStyle": {
                "color": [
                    "rgba(250,250,250,0.3)",
                    "rgba(200,200,200,0.3)"
                ]
            }
        }
    },
    "logAxis": {
        "axisLine": {
            "show": false,
            "lineStyle": {
                "color": "#333"
            }
        },
        "axisTick": {
            "show": false,
            "lineStyle": {
                "color": "#333"
            }
        },
        "axisLabel": {
            "show": false,
            "color": "#333"
        },
        "splitLine": {
            "show": false,
            "lineStyle": {
                "color": [
                    "#ccc"
                ]
            }
        },
        "splitArea": {
            "show": false,
            "areaStyle": {
                "color": [
                    "rgba(250,250,250,0.3)",
                    "rgba(200,200,200,0.3)"
                ]
            }
        }
    },
    "timeAxis": {
        "axisLine": {
            "show": false,
            "lineStyle": {
                "color": "#15ff51"
            }
        },
        "axisTick": {
            "show": false,
            "lineStyle": {
                "color": "#333"
            }
        },
        "axisLabel": {
            "show": false,
            "color": "#333"
        },
        "splitLine": {
            "show": false,
            "lineStyle": {
                "color": [
                    "#ccc"
                ]
            }
        },
        "splitArea": {
            "show": false,
            "areaStyle": {
                "color": [
                    "rgba(250,250,250,0.3)",
                    "rgba(200,200,200,0.3)"
                ]
            }
        }
    },
    "toolbox": {
        "iconStyle": {
            "borderColor": "rgba(255,255,255,0.8)"
        },
        "emphasis": {
            "iconStyle": {
                "borderColor": "#ffffff"
            }
        }
    },
    "legend": {
        "textStyle": {
            "color": "rgba(255,255,255,0.92)",
        },
    },
    "tooltip": {
        padding: 4,
        "axisPointer": {
            "lineStyle": {
                "color": "rgba(255,255,255,0.68)",
                "width": "1.5"
            },
            "crossStyle": {
                "color": "rgba(255,255,255,0.68)",
                "width": "2"
            }
        }
    },
    "timeline": {
        "lineStyle": {
            "color": "#646464",
            "width": 1
        },
        "itemStyle": {
            "color": "#6437d0",
            "borderWidth": 1
        },
        "controlStyle": {
            "color": "rgba(255,255,255,0.81)",
            "borderColor": "rgba(255,255,255,0.43)",
            "borderWidth": "1"
        },
        "checkpointStyle": {
            "color": "#3a0f68",
            "borderColor": "rgba(255,255,255,0.71)"
        },
        "label": {
            "color": "rgba(255,255,255,0.79)"
        },
        "emphasis": {
            "itemStyle": {
                "color": "#3e2084"
            },
            "controlStyle": {
                "color": "rgba(255,255,255,0.81)",
                "borderColor": "rgba(255,255,255,0.43)",
                "borderWidth": "1"
            },
            "label": {
                "color": "rgba(255,255,255,0.79)"
            }
        }
    },
    "visualMap": {
        "color": [
            "#1790cf",
            "#a2d4e6"
        ]
    },
    "dataZoom": {
        "backgroundColor": "rgba(47,69,84,0)",
        "dataBackgroundColor": "rgba(47,69,84,0.3)",
        "fillerColor": "rgba(167,183,204,0.4)",
        "handleColor": "#a7b7cc",
        "handleSize": "100%",
        "textStyle": {
            "color": "#333333"
        }
    },
    markLine: {
        lineStyle: {
            color: '#fffc',
        },
        label: {
            fontWeight: 700,
            distance: 2,
            fontSize: '0.76em',
            color: '#fff',
            textShadowColor: '#000',
            textShadowBlur: 2,
        },
    },
    "markPoint": {
        "label": {
            "color": "#ffffff"
        },
        "emphasis": {
            "label": {
                "color": "#ffffff"
            }
        }
    }
};
