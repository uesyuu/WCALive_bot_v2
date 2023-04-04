require('dotenv').config();

const functions = require("firebase-functions");

const admin = require("firebase-admin")
admin.initializeApp()

const fetch = require("node-fetch")

const { TwitterApi } = require("twitter-api-v2")
const client = new TwitterApi({
    appKey: process.env.CONSUMER_KEY,
    appSecret: process.env.CONSUMER_SECRET,
    accessToken: process.env.ACCESS_TOKEN_KEY,
    accessSecret: process.env.ACCESS_TOKEN_SECRET,
});

const url = "https://live.worldcubeassociation.org/api"
const req_data = {
    "query": "{ recentRecords { type tag attemptResult result { person { name country { name } } round { id competitionEvent { event { id name } competition { id name } } } } } }"
}

exports.scheduledFunction = functions.pubsub.schedule("0,20,40 * * * *")
    .timeZone("Asia/Tokyo")
    .onRun((context) => {
        tweetRecentResults()
        return null
    })

// exports.addJsonToFirestore = functions.https.onRequest(async (req, res) => {
//     await admin.firestore()
//         .collection("messages")
//         .doc("recentRecords")
//         .update({
//             data: JSON.stringify(beforeItems)
//         })
//     console.log("updated")
//     res.json({result: `Message added.`})
// })

function tweetContent(content) {
    client.v2.tweet(content)
}

function tweetRecentResults() {
    // WCA LiveのGraphQL APIでRecent RecordsをJSON形式で取得
    fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(req_data)
    }).then(response => {
        return response.json()
    }).then(data => {
        admin.firestore()
            .collection("messages")
            .doc("recentRecords")
            .get()
            .then(doc => {
                if (doc.exists) {
                    const beforeData = JSON.parse(doc.data().data)

                    // 前回との差分を取得
                    const difference = []
                    for (let item of data.data.recentRecords) {
                        let noneFlag = true
                        for (let beforeItem of beforeData.data.recentRecords) {
                            if (
                                item.result.round.competitionEvent.competition.id === beforeItem.result.round.competitionEvent.competition.id
                                && item.result.round.competitionEvent.event.name === beforeItem.result.round.competitionEvent.event.name
                                && item.type === beforeItem.type
                                && item.tag === beforeItem.tag
                                && item.attemptResult === beforeItem.attemptResult
                                && item.result.person.name === beforeItem.result.person.name
                            ) {
                                noneFlag = false
                                break
                            }
                        }
                        if (noneFlag) {
                            difference.push(item)
                        }
                    }

                    // 更新情報を整形してツイート
                    for (let record of difference) {
                        const person = record.result.person.name
                        const country = record.result.person.country.name
                        const event = record.result.round.competitionEvent.event.name
                        const recordType = record.type
                        const recordTag = record.tag
                        const isAverage = record.type === "average"
                        const result = formatAttemptResult(record.attemptResult, record.result.round.competitionEvent.event.id, isAverage)
                        const competition = record.result.round.competitionEvent.competition.name
                        const competitionUrl = `/competitions/${record.result.round.competitionEvent.competition.id}/rounds/${record.result.round.id}`

                        const tweetSentence = `${person} (from ${country}) just got the ${event} ${recordType} ${recordTag} (${result}) at ${competition} https://live.worldcubeassociation.org${competitionUrl}`

                        // console.log(tweetSentence)
                        tweetContent(tweetSentence)
                    }

                    // 差分があればfetchしたデータをFirestoreに上書き
                    if (difference.length !== 0) {
                        admin.firestore()
                            .collection("messages")
                            .doc("recentRecords")
                            .update({
                                data: JSON.stringify(data)
                            }).then(() => {
                            console.log("updated firestore")
                        })
                    }
                }
            })
    }).catch(error => {
    })
}

// MBLDのattemptResultを必要な値に変換
function decodeMBLDAttempt(value) {
    let solved = 0
    let attempted = 0
    let centiSecond = value
    if (value <= 0) {
        return [solved, attempted, centiSecond]
    }
    const missed = value % 100
    const second = Math.floor(value / 100) % 1e5
    const points = 99 - (Math.floor(value / 1e7) % 100)
    solved = points + missed
    attempted = solved + missed
    if (second === 99999) {
        centiSecond = null // TODO
    } else {
        centiSecond = second * 100
    }
    return [solved, attempted, centiSecond]
}

// センチ秒をMBLDの記録タイムに変換
function centiSecondToMBLDTimeFormat(value) {
    const minutes = Math.floor(value / 6000)
    const seconds = Math.floor((value % 6000) / 100)
    const secondsStr = seconds >= 10 ? seconds : `0${seconds}`
    return `${minutes}:${secondsStr}`
}

// MBLDとFMC以外の競技のattemptResult(センチ秒)を記録タイムに変換
function centiSecondsToTimeFormat(value) {
    const minutes = Math.floor(value / 6000)
    const minutesStr = minutes === 0 ? "" : `${minutes}:`
    const seconds = Math.floor((value % 6000) / 100)
    const secondsStr = (minutes === 0 || seconds >= 10) ? seconds : `0${seconds}`
    const centiSeconds = Math.floor(value % 100)
    const centiSecondsStr = centiSeconds >= 10 ? centiSeconds : `0${centiSeconds}`
    return `${minutesStr}${secondsStr}.${centiSecondsStr}`
}

// MBLD用の記録文字列にフォーマット
function formatMBLDAttempt(attempt) {
    let solved, attempted, centiSeconds
    [solved, attempted, centiSeconds] = decodeMBLDAttempt(attempt)
    const clockFormat = centiSecondToMBLDTimeFormat(centiSeconds)
    return `${solved}/${attempted} ${clockFormat}`
}

// 競技ごとの記録文字列にフォーマット
function formatAttemptResult(attemptResult, eventId, isAverage) {
    const result = parseInt(attemptResult)
    if (eventId === "333fm") {
        return isAverage ? (result / 100).toFixed(2) : result // TODO
    } else if (eventId === "333mbf") {
        return formatMBLDAttempt(result)
    } else {
        return centiSecondsToTimeFormat(result)
    }
}

const beforeItems =
    {
        "data": {
            "recentRecords": [
                {
                    "attemptResult": 548,
                    "result": {
                        "person": {"country": {"name": "Philippines"}, "name": "Leo Borromeo"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1410",
                                    "name": "Cube Ta Bai sa Cebu 2022"
                                }, "event": {"id": "333", "name": "3x3x3 Cube"}
                            }, "id": "20659"
                        }
                    },
                    "tag": "CR",
                    "type": "average"
                },
                {
                    "attemptResult": 148,
                    "result": {
                        "person": {"country": {"name": "Australia"}, "name": "Phoenix Patterson"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1420", "name": "Apollo Bay Cubing 2022"},
                                "event": {"id": "222", "name": "2x2x2 Cube"}
                            }, "id": "20869"
                        }
                    },
                    "tag": "CR",
                    "type": "average"
                },
                {
                    "attemptResult": 933,
                    "result": {
                        "person": {"country": {"name": "New Zealand"}, "name": "Dwyane Ramos"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1419", "name": "Opawa Open 2022"},
                                "event": {"id": "333oh", "name": "3x3x3 One-Handed"}
                            }, "id": "20854"
                        }
                    },
                    "tag": "CR",
                    "type": "average"
                },
                {
                    "attemptResult": 2945,
                    "result": {
                        "person": {"country": {"name": "Singapore"}, "name": "Tristan Chua Yong"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1387",
                                    "name": "Johor Big Cube Challenge 2022"
                                }, "event": {"id": "minx", "name": "Megaminx"}
                            }, "id": "20340"
                        }
                    },
                    "tag": "CR",
                    "type": "average"
                },
                {
                    "attemptResult": 179,
                    "result": {
                        "person": {"country": {"name": "China"}, "name": "Yanchen Zhu (朱彦臣)"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1405",
                                    "name": "Nanaimo Back to School 2022"
                                }, "event": {"id": "skewb", "name": "Skewb"}
                            }, "id": "20596"
                        }
                    },
                    "tag": "CR",
                    "type": "average"
                },
                {
                    "attemptResult": 520348604,
                    "result": {
                        "person": {"country": {"name": "Poland"}, "name": "Krzysztof Bober"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1436",
                                    "name": "Szansa Cubing Open Warsaw 2022"
                                }, "event": {"id": "333mbf", "name": "3x3x3 Multi-Blind"}
                            }, "id": "21104"
                        }
                    },
                    "tag": "CR",
                    "type": "single"
                },
                {
                    "attemptResult": 481,
                    "result": {
                        "person": {"country": {"name": "India"}, "name": "Aryan Chhabra"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1394",
                                    "name": "IISER Mohali Cube Open 2022"
                                }, "event": {"id": "333", "name": "3x3x3 Cube"}
                            }, "id": "20432"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 746,
                    "result": {
                        "person": {"country": {"name": "Egypt"}, "name": "Hannah Nader Eskander"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1446", "name": "Cubing Egypt 2022"},
                                "event": {"id": "333", "name": "3x3x3 Cube"}
                            }, "id": "21261"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 846,
                    "result": {
                        "person": {"country": {"name": "Cyprus"}, "name": "Michael Eleftheriades"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "333", "name": "3x3x3 Cube"}
                            }, "id": "20828"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 935,
                    "result": {
                        "person": {"country": {"name": "Oman"}, "name": "Mohammed Al Said"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "333", "name": "3x3x3 Cube"}
                            }, "id": "20306"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 1104,
                    "result": {
                        "person": {"country": {"name": "Syria"}, "name": "Ghaith Hussein"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "333", "name": "3x3x3 Cube"}
                            }, "id": "20307"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 668,
                    "result": {
                        "person": {"country": {"name": "United Kingdom"}, "name": "Chris Mills"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1406", "name": "Wakefield Autumn 2022"},
                                "event": {"id": "333", "name": "3x3x3 Cube"}
                            }, "id": "20600"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 872,
                    "result": {
                        "person": {"country": {"name": "Egypt"}, "name": "Hannah Nader Eskander"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1446", "name": "Cubing Egypt 2022"},
                                "event": {"id": "333", "name": "3x3x3 Cube"}
                            }, "id": "21261"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 955,
                    "result": {
                        "person": {"country": {"name": "Bahrain"}, "name": "Hasan Aqeel Nesaif"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "333", "name": "3x3x3 Cube"}
                            }, "id": "20306"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 1067,
                    "result": {
                        "person": {"country": {"name": "Oman"}, "name": "Mohammed Al Said"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "333", "name": "3x3x3 Cube"}
                            }, "id": "20308"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 1265,
                    "result": {
                        "person": {"country": {"name": "Syria"}, "name": "Ghaith Hussein"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "333", "name": "3x3x3 Cube"}
                            }, "id": "20307"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 151,
                    "result": {
                        "person": {"country": {"name": "Syria"}, "name": "Mohamed Yahia Antakli"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1446", "name": "Cubing Egypt 2022"},
                                "event": {"id": "222", "name": "2x2x2 Cube"}
                            }, "id": "21263"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 202,
                    "result": {
                        "person": {"country": {"name": "Egypt"}, "name": "Yahia Ahmed Abdallah Elhawy"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1446", "name": "Cubing Egypt 2022"},
                                "event": {"id": "222", "name": "2x2x2 Cube"}
                            }, "id": "21263"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 348,
                    "result": {
                        "person": {"country": {"name": "Oman"}, "name": "Mohammed Al Said"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "222", "name": "2x2x2 Cube"}
                            }, "id": "20309"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 187,
                    "result": {
                        "person": {"country": {"name": "Vietnam"}, "name": "Nông Quốc Duy"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1447", "name": "Hanoi Open 2022"},
                                "event": {"id": "222", "name": "2x2x2 Cube"}
                            }, "id": "21273"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 275,
                    "result": {
                        "person": {"country": {"name": "Kyrgyzstan"}, "name": "Alikhan Zhanybekov"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "222", "name": "2x2x2 Cube"}
                            }, "id": "20832"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 364,
                    "result": {
                        "person": {"country": {"name": "Bahrain"}, "name": "Daniel Adel Alhayki"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "222", "name": "2x2x2 Cube"}
                            }, "id": "20310"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 398,
                    "result": {
                        "person": {"country": {"name": "Oman"}, "name": "Mohammed Al Said"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "222", "name": "2x2x2 Cube"}
                            }, "id": "20309"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 444,
                    "result": {
                        "person": {"country": {"name": "Luxembourg"}, "name": "Carlo Glod"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1412", "name": "Swiss Nationals 2022"},
                                "event": {"id": "222", "name": "2x2x2 Cube"}
                            }, "id": "20700"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 480,
                    "result": {
                        "person": {"country": {"name": "Syria"}, "name": "Ghaith Hussein"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "222", "name": "2x2x2 Cube"}
                            }, "id": "20309"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 2213,
                    "result": {
                        "person": {"country": {"name": "United Kingdom"}, "name": "Eli Jay"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1406", "name": "Wakefield Autumn 2022"},
                                "event": {"id": "444", "name": "4x4x4 Cube"}
                            }, "id": "20602"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 2339,
                    "result": {
                        "person": {"country": {"name": "New Zealand"}, "name": "Ben Kirby"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1419", "name": "Opawa Open 2022"},
                                "event": {"id": "444", "name": "4x4x4 Cube"}
                            }, "id": "20849"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 2373,
                    "result": {
                        "person": {"country": {"name": "Vietnam"}, "name": "Đỗ Quang Hưng"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1447", "name": "Hanoi Open 2022"},
                                "event": {"id": "444", "name": "4x4x4 Cube"}
                            }, "id": "21275"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 3218,
                    "result": {
                        "person": {"country": {"name": "Morocco"}, "name": "Mohamed Elkhatri"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1402", "name": "Barby Cube 2022"},
                                "event": {"id": "444", "name": "4x4x4 Cube"}
                            }, "id": "20548"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 3356,
                    "result": {
                        "person": {"country": {"name": "Egypt"}, "name": "Rafik Eskandar"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "444", "name": "4x4x4 Cube"}
                            }, "id": "20834"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 3438,
                    "result": {
                        "person": {"country": {"name": "Oman"}, "name": "Mohammed Al Said"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "444", "name": "4x4x4 Cube"}
                            }, "id": "20311"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 5558,
                    "result": {
                        "person": {"country": {"name": "Syria"}, "name": "Ghaith Hussein"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "444", "name": "4x4x4 Cube"}
                            }, "id": "20311"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 16837,
                    "result": {
                        "person": {"country": {"name": "Yemen"}, "name": "Mohammed Ameen Abdulrahman"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1446", "name": "Cubing Egypt 2022"},
                                "event": {"id": "444", "name": "4x4x4 Cube"}
                            }, "id": "21265"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 2377,
                    "result": {
                        "person": {"country": {"name": "Philippines"}, "name": "Leo Borromeo"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1410",
                                    "name": "Cube Ta Bai sa Cebu 2022"
                                }, "event": {"id": "444", "name": "4x4x4 Cube"}
                            }, "id": "20664"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 3573,
                    "result": {
                        "person": {"country": {"name": "Oman"}, "name": "Mohammed Al Said"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "444", "name": "4x4x4 Cube"}
                            }, "id": "20311"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 3724,
                    "result": {
                        "person": {"country": {"name": "Morocco"}, "name": "Mohamed Elkhatri"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1402", "name": "Barby Cube 2022"},
                                "event": {"id": "444", "name": "4x4x4 Cube"}
                            }, "id": "20548"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 4042,
                    "result": {
                        "person": {"country": {"name": "Egypt"}, "name": "Rafik Eskandar"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "444", "name": "4x4x4 Cube"}
                            }, "id": "20834"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 4107,
                    "result": {
                        "person": {"country": {"name": "Kyrgyzstan"}, "name": "Alikhan Zhanybekov"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "444", "name": "4x4x4 Cube"}
                            }, "id": "20833"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 4596,
                    "result": {
                        "person": {"country": {"name": "Bahrain"}, "name": "Hasan Aqeel Nesaif"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "444", "name": "4x4x4 Cube"}
                            }, "id": "20311"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 6120,
                    "result": {
                        "person": {"country": {"name": "Syria"}, "name": "Ghaith Hussein"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "444", "name": "4x4x4 Cube"}
                            }, "id": "20311"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                },
                {
                    "attemptResult": 4395,
                    "result": {
                        "person": {"country": {"name": "Indonesia"}, "name": "Firstian Fushada (符逢城)"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1387",
                                    "name": "Johor Big Cube Challenge 2022"
                                }, "event": {"id": "555", "name": "5x5x5 Cube"}
                            }, "id": "20333"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                },
                {
                    "attemptResult": 4429,
                    "result": {
                        "person": {"country": {"name": "Malaysia"}, "name": "Ivan Lew Yi Wen (刘义文)"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1387",
                                    "name": "Johor Big Cube Challenge 2022"
                                }, "event": {"id": "555", "name": "5x5x5 Cube"}
                            }, "id": "20332"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                },
                {
                    "attemptResult": 4751,
                    "result": {
                        "person": {"country": {"name": "New Zealand"}, "name": "Jasper Murray"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1419", "name": "Opawa Open 2022"},
                                "event": {"id": "555", "name": "5x5x5 Cube"}
                            }, "id": "20850"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 6028,
                    "result": {
                        "person": {"country": {"name": "Oman"}, "name": "Mohammed Al Said"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "555", "name": "5x5x5 Cube"}
                            }, "id": "20313"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 7329,
                    "result": {
                        "person": {"country": {"name": "Cyprus"}, "name": "Michael Eleftheriades"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "555", "name": "5x5x5 Cube"}
                            }, "id": "20835"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 8690,
                    "result": {
                        "person": {"country": {"name": "Bahrain"}, "name": "Daniel Adel Alhayki"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "555", "name": "5x5x5 Cube"}
                            }, "id": "20313"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 13532,
                    "result": {
                        "person": {"country": {"name": "Syria"}, "name": "Ghaith Hussein"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "555", "name": "5x5x5 Cube"}
                            }, "id": "20313"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 28138,
                    "result": {
                        "person": {"country": {"name": "United Arab Emirates"}, "name": "Saeed Hisham ALdah"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "555", "name": "5x5x5 Cube"}
                            }, "id": "20313"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                },
                {
                    "attemptResult": 4723,
                    "result": {
                        "person": {"country": {"name": "Indonesia"}, "name": "Firstian Fushada (符逢城)"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1387",
                                    "name": "Johor Big Cube Challenge 2022"
                                }, "event": {"id": "555", "name": "5x5x5 Cube"}
                            }, "id": "20333"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 5086,
                    "result": {
                        "person": {"country": {"name": "Singapore"}, "name": "Daryl Tan Hong An"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1387",
                                    "name": "Johor Big Cube Challenge 2022"
                                }, "event": {"id": "555", "name": "5x5x5 Cube"}
                            }, "id": "20333"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 5125,
                    "result": {
                        "person": {"country": {"name": "Malaysia"}, "name": "Lim Hung (林弘)"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1387",
                                    "name": "Johor Big Cube Challenge 2022"
                                }, "event": {"id": "555", "name": "5x5x5 Cube"}
                            }, "id": "20333"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 5312,
                    "result": {
                        "person": {"country": {"name": "Philippines"}, "name": "Jose Polorhenzo Aquino"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1410",
                                    "name": "Cube Ta Bai sa Cebu 2022"
                                }, "event": {"id": "555", "name": "5x5x5 Cube"}
                            }, "id": "20665"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 6629,
                    "result": {
                        "person": {"country": {"name": "Oman"}, "name": "Mohammed Al Said"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "555", "name": "5x5x5 Cube"}
                            }, "id": "20313"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 7352,
                    "result": {
                        "person": {"country": {"name": "Egypt"}, "name": "Rafik Eskandar"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "555", "name": "5x5x5 Cube"}
                            }, "id": "20835"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 9948,
                    "result": {
                        "person": {"country": {"name": "Bahrain"}, "name": "Daniel Adel Alhayki"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "555", "name": "5x5x5 Cube"}
                            }, "id": "20313"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 7998,
                    "result": {
                        "person": {"country": {"name": "Indonesia"}, "name": "Firstian Fushada (符逢城)"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1387",
                                    "name": "Johor Big Cube Challenge 2022"
                                }, "event": {"id": "666", "name": "6x6x6 Cube"}
                            }, "id": "20336"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                },
                {
                    "attemptResult": 8261,
                    "result": {
                        "person": {"country": {"name": "China"}, "name": "Anyu Zhang (张安宇)"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1387",
                                    "name": "Johor Big Cube Challenge 2022"
                                }, "event": {"id": "666", "name": "6x6x6 Cube"}
                            }, "id": "20336"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 8360,
                    "result": {
                        "person": {"country": {"name": "Singapore"}, "name": "Daryl Tan Hong An"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1387",
                                    "name": "Johor Big Cube Challenge 2022"
                                }, "event": {"id": "666", "name": "6x6x6 Cube"}
                            }, "id": "20335"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 10122,
                    "result": {
                        "person": {"country": {"name": "Vietnam"}, "name": "Trương Khánh Tùng"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1387",
                                    "name": "Johor Big Cube Challenge 2022"
                                }, "event": {"id": "666", "name": "6x6x6 Cube"}
                            }, "id": "20334"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 10891,
                    "result": {
                        "person": {"country": {"name": "Bolivia"}, "name": "Josias Milan Sirpa Pinto"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1451", "name": "Urus Cubing 2022"},
                                "event": {"id": "666", "name": "6x6x6 Cube"}
                            }, "id": "21317"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 12555,
                    "result": {
                        "person": {"country": {"name": "Luxembourg"}, "name": "Carlo Glod"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1412", "name": "Swiss Nationals 2022"},
                                "event": {"id": "666", "name": "6x6x6 Cube"}
                            }, "id": "20706"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 13375,
                    "result": {
                        "person": {"country": {"name": "Oman"}, "name": "Mohammed Al Said"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "666", "name": "6x6x6 Cube"}
                            }, "id": "20314"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 17669,
                    "result": {
                        "person": {"country": {"name": "Armenia"}, "name": "Levon Pamukyan (Լեւոն Պամուկյան)"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1399", "name": "Berkeley Fall 2022"},
                                "event": {"id": "666", "name": "6x6x6 Cube"}
                            }, "id": "20487"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 21028,
                    "result": {
                        "person": {"country": {"name": "Bahrain"}, "name": "Daniel Adel Alhayki"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "666", "name": "6x6x6 Cube"}
                            }, "id": "20314"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 8987,
                    "result": {
                        "person": {"country": {"name": "Indonesia"}, "name": "Firstian Fushada (符逢城)"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1387",
                                    "name": "Johor Big Cube Challenge 2022"
                                }, "event": {"id": "666", "name": "6x6x6 Cube"}
                            }, "id": "20336"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 9320,
                    "result": {
                        "person": {"country": {"name": "Singapore"}, "name": "Daryl Tan Hong An"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1387",
                                    "name": "Johor Big Cube Challenge 2022"
                                }, "event": {"id": "666", "name": "6x6x6 Cube"}
                            }, "id": "20335"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 9549,
                    "result": {
                        "person": {"country": {"name": "United Kingdom"}, "name": "Eli Jay"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1406", "name": "Wakefield Autumn 2022"},
                                "event": {"id": "666", "name": "6x6x6 Cube"}
                            }, "id": "20606"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 10312,
                    "result": {
                        "person": {"country": {"name": "Vietnam"}, "name": "Trương Khánh Tùng"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1387",
                                    "name": "Johor Big Cube Challenge 2022"
                                }, "event": {"id": "666", "name": "6x6x6 Cube"}
                            }, "id": "20334"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 13448,
                    "result": {
                        "person": {"country": {"name": "Luxembourg"}, "name": "Carlo Glod"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1412", "name": "Swiss Nationals 2022"},
                                "event": {"id": "666", "name": "6x6x6 Cube"}
                            }, "id": "20706"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 15771,
                    "result": {
                        "person": {"country": {"name": "Oman"}, "name": "Mohammed Al Said"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "666", "name": "6x6x6 Cube"}
                            }, "id": "20314"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 21009,
                    "result": {
                        "person": {"country": {"name": "Armenia"}, "name": "Levon Pamukyan (Լեւոն Պամուկյան)"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1399", "name": "Berkeley Fall 2022"},
                                "event": {"id": "666", "name": "6x6x6 Cube"}
                            }, "id": "20487"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 21549,
                    "result": {
                        "person": {"country": {"name": "Bahrain"}, "name": "Daniel Adel Alhayki"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "666", "name": "6x6x6 Cube"}
                            }, "id": "20314"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 12381,
                    "result": {
                        "person": {"country": {"name": "Indonesia"}, "name": "Firstian Fushada (符逢城)"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1387",
                                    "name": "Johor Big Cube Challenge 2022"
                                }, "event": {"id": "777", "name": "7x7x7 Cube"}
                            }, "id": "20337"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 14666,
                    "result": {
                        "person": {"country": {"name": "Vietnam"}, "name": "Trương Khánh Tùng"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1387",
                                    "name": "Johor Big Cube Challenge 2022"
                                }, "event": {"id": "777", "name": "7x7x7 Cube"}
                            }, "id": "20339"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 19905,
                    "result": {
                        "person": {"country": {"name": "Luxembourg"}, "name": "Carlo Glod"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1412", "name": "Swiss Nationals 2022"},
                                "event": {"id": "777", "name": "7x7x7 Cube"}
                            }, "id": "20707"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 15405,
                    "result": {
                        "person": {"country": {"name": "Vietnam"}, "name": "Trương Khánh Tùng"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1387",
                                    "name": "Johor Big Cube Challenge 2022"
                                }, "event": {"id": "777", "name": "7x7x7 Cube"}
                            }, "id": "20339"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 2100,
                    "result": {
                        "person": {"country": {"name": "Colombia"}, "name": "Jefferson Andres Durango Argaez"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1454",
                                    "name": "Aves Maria Sabaneta 2022"
                                }, "event": {"id": "333bf", "name": "3x3x3 Blindfolded"}
                            }, "id": "21362"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 3167,
                    "result": {
                        "person": {"country": {"name": "Estonia"}, "name": "Remo Pihel"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1444",
                                    "name": "Squack FMC Helsinki 2022"
                                }, "event": {"id": "333fm", "name": "3x3x3 Fewest Moves"}
                            }, "id": "21228"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 793,
                    "result": {
                        "person": {"country": {"name": "France"}, "name": "Juliette Sébastien"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1402", "name": "Barby Cube 2022"},
                                "event": {"id": "333oh", "name": "3x3x3 One-Handed"}
                            }, "id": "20556"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 1633,
                    "result": {
                        "person": {"country": {"name": "Bahrain"}, "name": "Daniel Adel Alhayki"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "333oh", "name": "3x3x3 One-Handed"}
                            }, "id": "20316"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 1017,
                    "result": {
                        "person": {"country": {"name": "United Kingdom"}, "name": "Nicholas Archer"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1440",
                                    "name": "Droitwich Spa Autumn 2022"
                                }, "event": {"id": "333oh", "name": "3x3x3 One-Handed"}
                            }, "id": "21181"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 2262,
                    "result": {
                        "person": {"country": {"name": "Bahrain"}, "name": "Daniel Adel Alhayki"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "333oh", "name": "3x3x3 One-Handed"}
                            }, "id": "20316"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 499,
                    "result": {
                        "person": {"country": {"name": "Italy"}, "name": "Matteo Dummar"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1412", "name": "Swiss Nationals 2022"},
                                "event": {"id": "clock", "name": "Clock"}
                            }, "id": "20712"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 722,
                    "result": {
                        "person": {"country": {"name": "Turkey"}, "name": "Sarp Abaç"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "clock", "name": "Clock"}
                            }, "id": "20839"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 831,
                    "result": {
                        "person": {"country": {"name": "Egypt"}, "name": "Rafik Eskandar"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "clock", "name": "Clock"}
                            }, "id": "20839"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 834,
                    "result": {
                        "person": {"country": {"name": "Vietnam"}, "name": "Ngô Việt Kiên"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1419", "name": "Opawa Open 2022"},
                                "event": {"id": "clock", "name": "Clock"}
                            }, "id": "20856"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 1495,
                    "result": {
                        "person": {"country": {"name": "Cyprus"}, "name": "Michael Eleftheriades"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "clock", "name": "Clock"}
                            }, "id": "20839"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 516,
                    "result": {
                        "person": {"country": {"name": "Italy"}, "name": "Matteo Dummar"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1402", "name": "Barby Cube 2022"},
                                "event": {"id": "clock", "name": "Clock"}
                            }, "id": "20557"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 620,
                    "result": {
                        "person": {
                            "country": {"name": "Brazil"},
                            "name": "Roberto da Costa Barbosa Nunes Caldas"
                        },
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1411", "name": "Planeta.Rio Open 2022"},
                                "event": {"id": "clock", "name": "Clock"}
                            }, "id": "20690"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 621,
                    "result": {
                        "person": {"country": {"name": "Switzerland"}, "name": "Mattia Pasquini"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1412", "name": "Swiss Nationals 2022"},
                                "event": {"id": "clock", "name": "Clock"}
                            }, "id": "20712"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 885,
                    "result": {
                        "person": {"country": {"name": "Vietnam"}, "name": "Ngô Việt Kiên"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1419", "name": "Opawa Open 2022"},
                                "event": {"id": "clock", "name": "Clock"}
                            }, "id": "20856"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 1130,
                    "result": {
                        "person": {"country": {"name": "Egypt"}, "name": "Rafik Eskandar"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "clock", "name": "Clock"}
                            }, "id": "20839"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 1569,
                    "result": {
                        "person": {"country": {"name": "Cyprus"}, "name": "Michael Eleftheriades"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "clock", "name": "Clock"}
                            }, "id": "20839"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 3272,
                    "result": {
                        "person": {"country": {"name": "Hungary"}, "name": "Gergely Novotni"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1441",
                                    "name": "Slovenian Nationals 2022"
                                }, "event": {"id": "minx", "name": "Megaminx"}
                            }, "id": "21204"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 3362,
                    "result": {
                        "person": {"country": {"name": "Switzerland"}, "name": "Timo Günthardt"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1412", "name": "Swiss Nationals 2022"},
                                "event": {"id": "minx", "name": "Megaminx"}
                            }, "id": "20714"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 4016,
                    "result": {
                        "person": {"country": {"name": "Slovenia"}, "name": "Matic Omulec"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1441",
                                    "name": "Slovenian Nationals 2022"
                                }, "event": {"id": "minx", "name": "Megaminx"}
                            }, "id": "21204"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 4062,
                    "result": {
                        "person": {"country": {"name": "Romania"}, "name": "Ianis Costin Chele"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1403", "name": "AOpen in Rome 2022"},
                                "event": {"id": "minx", "name": "Megaminx"}
                            }, "id": "20576"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 8719,
                    "result": {
                        "person": {"country": {"name": "Bahrain"}, "name": "Daniel Adel Alhayki"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "minx", "name": "Megaminx"}
                            }, "id": "20318"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 8983,
                    "result": {
                        "person": {"country": {"name": "Oman"}, "name": "Mohammed Al Said"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "minx", "name": "Megaminx"}
                            }, "id": "20318"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 13445,
                    "result": {
                        "person": {"country": {"name": "Syria"}, "name": "Ghaith Hussein"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "minx", "name": "Megaminx"}
                            }, "id": "20318"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 16685,
                    "result": {
                        "person": {"country": {"name": "United Arab Emirates"}, "name": "Ali Alshamsi"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "minx", "name": "Megaminx"}
                            }, "id": "20318"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 3498,
                    "result": {
                        "person": {"country": {"name": "United Kingdom"}, "name": "Sean Moran"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1406", "name": "Wakefield Autumn 2022"},
                                "event": {"id": "minx", "name": "Megaminx"}
                            }, "id": "20615"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 3557,
                    "result": {
                        "person": {"country": {"name": "Switzerland"}, "name": "Timo Günthardt"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1412", "name": "Swiss Nationals 2022"},
                                "event": {"id": "minx", "name": "Megaminx"}
                            }, "id": "20714"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 3630,
                    "result": {
                        "person": {"country": {"name": "Hungary"}, "name": "Gergely Novotni"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1441",
                                    "name": "Slovenian Nationals 2022"
                                }, "event": {"id": "minx", "name": "Megaminx"}
                            }, "id": "21204"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 4801,
                    "result": {
                        "person": {"country": {"name": "Romania"}, "name": "Ianis Costin Chele"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1403", "name": "AOpen in Rome 2022"},
                                "event": {"id": "minx", "name": "Megaminx"}
                            }, "id": "20576"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 9821,
                    "result": {
                        "person": {"country": {"name": "Bahrain"}, "name": "Daniel Adel Alhayki"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "minx", "name": "Megaminx"}
                            }, "id": "20318"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 10930,
                    "result": {
                        "person": {"country": {"name": "Oman"}, "name": "Mohammed Al Said"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "minx", "name": "Megaminx"}
                            }, "id": "20318"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 14402,
                    "result": {
                        "person": {"country": {"name": "Syria"}, "name": "Ghaith Hussein"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "minx", "name": "Megaminx"}
                            }, "id": "20318"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 18426,
                    "result": {
                        "person": {"country": {"name": "United Arab Emirates"}, "name": "Ali Alshamsi"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "minx", "name": "Megaminx"}
                            }, "id": "20318"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 114,
                    "result": {
                        "person": {"country": {"name": "Italy"}, "name": "Lorenzo Mauro"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1403", "name": "AOpen in Rome 2022"},
                                "event": {"id": "pyram", "name": "Pyraminx"}
                            }, "id": "20577"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 144,
                    "result": {
                        "person": {"country": {"name": "United Kingdom"}, "name": "Daniel Partridge"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1406", "name": "Wakefield Autumn 2022"},
                                "event": {"id": "pyram", "name": "Pyraminx"}
                            }, "id": "20617"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 404,
                    "result": {
                        "person": {"country": {"name": "Bahrain"}, "name": "Daniel Adel Alhayki"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "pyram", "name": "Pyraminx"}
                            }, "id": "20319"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 794,
                    "result": {
                        "person": {"country": {"name": "Syria"}, "name": "Ghaith Hussein"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "pyram", "name": "Pyraminx"}
                            }, "id": "20319"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 201,
                    "result": {
                        "person": {"country": {"name": "Australia"}, "name": "Wesley Allen"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1420", "name": "Apollo Bay Cubing 2022"},
                                "event": {"id": "pyram", "name": "Pyraminx"}
                            }, "id": "20876"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 258,
                    "result": {
                        "person": {"country": {"name": "United Kingdom"}, "name": "Daniel Partridge"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1406", "name": "Wakefield Autumn 2022"},
                                "event": {"id": "pyram", "name": "Pyraminx"}
                            }, "id": "20618"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 300,
                    "result": {
                        "person": {"country": {"name": "Hungary"}, "name": "Bálint Csengő"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1441",
                                    "name": "Slovenian Nationals 2022"
                                }, "event": {"id": "pyram", "name": "Pyraminx"}
                            }, "id": "21206"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 466,
                    "result": {
                        "person": {"country": {"name": "Kyrgyzstan"}, "name": "Alikhan Zhanybekov"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "pyram", "name": "Pyraminx"}
                            }, "id": "20841"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 476,
                    "result": {
                        "person": {"country": {"name": "Bahrain"}, "name": "Daniel Adel Alhayki"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "pyram", "name": "Pyraminx"}
                            }, "id": "20319"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 537,
                    "result": {
                        "person": {"country": {"name": "Cyprus"}, "name": "Michael Eleftheriades"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "pyram", "name": "Pyraminx"}
                            }, "id": "20841"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 303,
                    "result": {
                        "person": {"country": {"name": "Bahrain"}, "name": "Daniel Adel Alhayki"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "skewb", "name": "Skewb"}
                            }, "id": "20320"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 280,
                    "result": {
                        "person": {"country": {"name": "Vietnam"}, "name": "Nông Quốc Khánh"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1447", "name": "Hanoi Open 2022"},
                                "event": {"id": "skewb", "name": "Skewb"}
                            }, "id": "21281"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 308,
                    "result": {
                        "person": {"country": {"name": "Indonesia"}, "name": "Zaky Kurnia Falah"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1383",
                                    "name": "Taman Anggrek Speedcubing A 2022"
                                }, "event": {"id": "skewb", "name": "Skewb"}
                            }, "id": "20297"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 313,
                    "result": {
                        "person": {"country": {"name": "Slovenia"}, "name": "Jakob Kitak"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1441",
                                    "name": "Slovenian Nationals 2022"
                                }, "event": {"id": "skewb", "name": "Skewb"}
                            }, "id": "21208"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 315,
                    "result": {
                        "person": {"country": {"name": "Norway"}, "name": "Håvard Færden"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1435", "name": "Sandnes Open 2022"},
                                "event": {"id": "skewb", "name": "Skewb"}
                            }, "id": "21097"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 443,
                    "result": {
                        "person": {"country": {"name": "Bahrain"}, "name": "Daniel Adel Alhayki"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "skewb", "name": "Skewb"}
                            }, "id": "20320"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 1176,
                    "result": {
                        "person": {"country": {"name": "Palestine"}, "name": "Ismael Khalil"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "skewb", "name": "Skewb"}
                            }, "id": "20320"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 1253,
                    "result": {
                        "person": {"country": {"name": "Egypt"}, "name": "Rafik Eskandar"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "sq1", "name": "Square-1"}
                            }, "id": "20842"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 1462,
                    "result": {
                        "person": {"country": {"name": "Luxembourg"}, "name": "Carlo Glod"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1412", "name": "Swiss Nationals 2022"},
                                "event": {"id": "sq1", "name": "Square-1"}
                            }, "id": "20719"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 1573,
                    "result": {
                        "person": {"country": {"name": "Kyrgyzstan"}, "name": "Alikhan Zhanybekov"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "sq1", "name": "Square-1"}
                            }, "id": "20842"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 1721,
                    "result": {
                        "person": {"country": {"name": "Bahrain"}, "name": "Daniel Adel Alhayki"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "sq1", "name": "Square-1"}
                            }, "id": "20321"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 2959,
                    "result": {
                        "person": {"country": {"name": "Cyprus"}, "name": "Michael Eleftheriades"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "sq1", "name": "Square-1"}
                            }, "id": "20842"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 679,
                    "result": {
                        "person": {"country": {"name": "New Zealand"}, "name": "Adrien Auvray Matyn"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1419", "name": "Opawa Open 2022"},
                                "event": {"id": "sq1", "name": "Square-1"}
                            }, "id": "20864"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 1478,
                    "result": {
                        "person": {"country": {"name": "Egypt"}, "name": "Rafik Eskandar"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "sq1", "name": "Square-1"}
                            }, "id": "20842"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 1775,
                    "result": {
                        "person": {"country": {"name": "Kyrgyzstan"}, "name": "Alikhan Zhanybekov"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "sq1", "name": "Square-1"}
                            }, "id": "20842"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 2472,
                    "result": {
                        "person": {"country": {"name": "Bahrain"}, "name": "Daniel Adel Alhayki"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1385", "name": "Dubai Summer Open 2022"},
                                "event": {"id": "sq1", "name": "Square-1"}
                            }, "id": "20321"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 3465,
                    "result": {
                        "person": {"country": {"name": "Cyprus"}, "name": "Michael Eleftheriades"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1418", "name": "İstanbul Fall 2022"},
                                "event": {"id": "sq1", "name": "Square-1"}
                            }, "id": "20842"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 10392,
                    "result": {
                        "person": {"country": {"name": "Switzerland"}, "name": "Ezra Hirschi"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1412", "name": "Swiss Nationals 2022"},
                                "event": {"id": "444bf", "name": "4x4x4 Blindfolded"}
                            }, "id": "20720"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }, {
                    "attemptResult": 11207,
                    "result": {
                        "person": {"country": {"name": "Switzerland"}, "name": "Ezra Hirschi"},
                        "round": {
                            "competitionEvent": {
                                "competition": {"id": "1412", "name": "Swiss Nationals 2022"},
                                "event": {"id": "444bf", "name": "4x4x4 Blindfolded"}
                            }, "id": "20720"
                        }
                    },
                    "tag": "NR",
                    "type": "average"
                }, {
                    "attemptResult": 900206000,
                    "result": {
                        "person": {"country": {"name": "Croatia"}, "name": "Jakov Srečković"},
                        "round": {
                            "competitionEvent": {
                                "competition": {
                                    "id": "1441",
                                    "name": "Slovenian Nationals 2022"
                                }, "event": {"id": "333mbf", "name": "3x3x3 Multi-Blind"}
                            }, "id": "21210"
                        }
                    },
                    "tag": "NR",
                    "type": "single"
                }]
        }
    }