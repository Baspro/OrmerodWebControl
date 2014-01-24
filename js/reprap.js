/*! Reprap Ormerod Control v0.10 | by Matt Burnett <matt@burny.co.uk>. | open license
 */
var polling = false;
var printing = false;
var paused = false;
var ormerodIP;
var layerHeight = 0.24;
var layerCount;
var currentLayer;
var objHeight;
var layerData = [];
var printStartTime;

//Temp Chart
var chart;
var maxDataPoints = 200;
var chartData = [[], []];
var bedColour = "#454BFF"; //blue
var headColour = "#FC2D2D" //red

jQuery.extend({
    askElle: function(reqType, code) {
        var result = null;
        $.ajax({
            url: "http://" + ormerodIP + "/rr_" + reqType,
            dataType: 'json',
            data: {gcode: code},
            async: false,
            success: function(data) {
                result = data;
            }
        });
        return result;
    }
});

$(document).ready(function() {
    ormerodIP = location.host;
    $('a#hostLocation').text(ormerodIP);
    
    if ($.support.fileDrop) {
        fileDrop();
    } else {
        alert('Your browser does not support file drag-n-drop :(');
    }

    //fill chart with dummy data
    for (var i = 0; i < maxDataPoints; i++) {
        chartData[0].push([i, 20]);
        chartData[1].push([i, 10]);
    }

    //chart line colours
    $('#bedTxt').css("color", bedColour);
    $('#headTxt').css("color", headColour);

    chart = $.plot("#tempchart", chartData, {
        series: {shadowSize: 0},
        colors: [bedColour, headColour],
        yaxis: {min: -20, max: 250},
        xaxis: {show: false},
        grid: {
            borderWidth: 0
        }
    });
});

$('#connect').on('click', function() {
    if (polling) {
        polling = false;
        updatePage();
    } else {
        polling = true;
        updatePage();
        listGFiles();
        poll();
    }
});

//temp controls
$('div#bedTemperature button#setBedTemp, div#bedTemperature a#bedTempLink').on('click', function() {
    var code;
    if (this.nodeName === 'BUTTON') {
        code = $('input#bedTempInput').val();
    } else {
        code = $(this).text();
    }
    $.askElle('gcode', "M140 S" + code);
});
$('div#headTemperature button#setHeadTemp, div#headTemperature a#headTempLink').on('click', function() {
    var head = 0;
    var code;
    if (this.nodeName === 'BUTTON') {
        code = $('input#headTempInput').val();
    } else {
        code = $(this).text();
    }
    $.askElle('gcode', "G10 P" + head + " S" + code + "\nT" + head);
});
$('input#bedTempInput').keydown(function(event) {
    if (event.which === 13) {
        event.preventDefault();
        $.askElle('gcode', "M140 S" + $(this).val());
    }
});
$('input#headTempInput').keydown(function(event) {
    var head = 0;
    if (event.which === 13) {
        event.preventDefault();
        $.askElle('gcode', "G10 P" + head + " S" + $(this).val() + "\nT" + head);
    }
});

//feed controls
$('div#feed button#feed').on('click', function() {
    var amount = $(this).val();
    var dir = "";
    if ($('input[name="feeddir"]:checked').attr('id') == "reverse") {
        dir = "-";
    }
    var feedRate = " F" + $('input[name="speed"]:checked').val();
    var code = "M120\nM83\nG1 E" + dir + amount + feedRate + "\nM121";
    $.askElle('gcode', code);
});

//gcodes
$('div#sendG button#txtinput, div#sendG a#gLink').on('click', function() {
    var code;
    if (this.nodeName === 'BUTTON') {
        code = $('input#gInput').val();
    } else {
        code = $(this).text();
    }
    $.askElle('gcode', code);
});
$('input#gInput').keydown(function(event) {
    if (event.which === 13) {
        event.preventDefault();
        $.askElle('gcode', $(this).val());
    }
});

//move controls
$('table#moveHead button').on('click', function() {
    var btnVal = $(this).attr('value');
    if (btnVal) {
        $.askElle('gcode', btnVal);
    } else {
        var value = $(this).text();

        var feedRate = " F2000";
        if (value.indexOf("Z") >= 0)
            feedRate = " F200";

        var movePreCode = "M120\nG91\nG1";
        var movePostCode = "\nM121";
        $.askElle('gcode', movePreCode + value + feedRate + movePostCode);
    }
});

//panic buttons
$('div#panicBtn button').on('click', function() {
    var btnVal = $(this).attr('value');
    switch (btnVal) {
        case "M112":
            //panic stop
            polling = false;
            paused = false;
            break;
        case "reset":
            //reset printing after pause
            printing = false;
            btnVal="";
            //switch off heaters
            $.askElle('gcode', "M140 S0"); //bed off
            $.askElle('gcode', "G10 P0 S0\nT0"); //head 0 off
            resetLayerData();
        case "M24":
            //resume
            paused = false;
            $('button#pause').removeClass('active').text('Pause').attr('value', 'M25');
            $('button#printing').text("Ready :)");
            $('button#reset').addClass('hidden');
            break;
        case "M25":
            //pause
            paused = true;
            $(this).addClass('active').text('Resume').attr('value', 'M24');
            $('button#printing').text("Paused");
            $('button#reset').removeClass('hidden');
            break;
    }
    $.askElle('gcode', btnVal);
});

//g files
$("div#gFileList, div#gFileList2, div#gFileList3").on('click', 'button#gFileLink', function() {
    var filename = $(this).text();
    $.askElle('gcode', "M23 " + filename + "\nM24");
    resetLayerData();
}).on('click', 'span#fileDelete', function() {
    var filename = $(this).parent().text();
    $.askElle('gcode', "M30 " + filename);
    listGFiles();
});
$("button#filereload").on('click', function() {
    listGFiles();
});

function isNumber(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
}

function fileDrop() {
    $('#dropTarget').fileDrop({
        decodeBase64: true,
        removeDataUriScheme: true,
        onFileRead: function(fileCollection) {
            //Loop through each file that was dropped
            $.each(fileCollection, function(i) {
                var ext = getFileExt(this.name);
                var fname = getFileName(this.name);
                if (ext !== "g" && ext !== "gco" && ext !== "gcode") {
                    alert('Not a G Code file');
                    return false;
                } else {
                    if (fname > 8) {
                        fname = fname.substr(0, 8);
                    }
                    fileUpload(this.data, fname + '.g');
                }
            });
        },
        overClass: 'btn-success'
    });
}

function fileUpload(gcodes, filename) {
    var lines = gcodes.split(/\r\n|\r|\n/g);
    var line, codeType;
    var lineCount = lines.length;
    $.askElle('gcode', "M28 " + filename);
    for (var i = 0; i < lineCount; i++) {
        line = lines[i].split(';');
        codeType = line[0].substr(0, 1);
        if (codeType === "G" || codeType === "M" || codeType === "T") {
            //test += line+"\n";
            $.askElle('gcode', line[0] + "\n");
        }
    }
    $.askElle('gcode', "M29");
    listGFiles();
}

function listGFiles() {
    var count = 0;
    var list = "gFileList";
    $('div#gFileList, div#gFileList2, div#gFileList3').html("");
    var result = $.askElle("files", "");
    result.files.forEach(function(item) {
        count++;
        switch (true) {
            case (count > 14):
                list = "gFileList2";
                break;
            case (count > 29):
                list = "gFileList3";
                break;
        }
        $('div#' + list).append('<button type="button" class="btn btn-default" id="gFileLink"><span class="pull-left">' + item + '</span><span id="fileDelete" class="glyphicon glyphicon-trash pull-right"></span></button>');
    });
}

function getFileExt(filename) {
    return filename.split('.').pop();
}

function getFileName(filename) {
    return filename.split('.').shift();
}

function disableButtons(which) {
    switch (which) {
        case "head":
            $('table#moveHead button, table#temp button, table#extruder button, table#extruder label').addClass('disabled');
            break;
        case "panic":
            $('div#panicBtn button').addClass('disabled');
            $('button#reset').addClass('hidden');
            break;
        case "gfilelist":
            $('div#gFileList button, div#gFileList2 button, div#gFileList3 button').addClass('disabled');
            break;
    }
}

function enableButtons(which) {
    switch (which) {
        case "head":
            $('table#moveHead button, table#temp button, table#extruder button, table#extruder label').removeClass('disabled');
            break;
        case "panic":
            $('div#panicBtn button').removeClass('disabled');
            break;
        case "gfilelist":
            $('div#gFileList button, div#gFileList2 button, div#gFileList3 button').removeClass('disabled');
            break;
    }
}

function message(type, text) {
    $('div#messageBox').removeClass('alert-success alert-info alert-warning alert-danger');
    $('div#messageBox').html("");
    if (type !== 'hide') {
        var closeBtn = '<a class="close" data-dismiss="alert" href="#" aria-hidden="true">&times;</a>';
        $('div#messageBox').addClass('alert-' + type).html(closeBtn + text);
    }
}

function updatePage() {
    var status = $.askElle("poll", "");
    if (!status || !polling) {
        $('button#connect').removeClass('btn-success').addClass('btn-danger');
        $('button#printing').removeClass('btn-warning').removeClass('btn-success').addClass('btn-danger').text("Disconnected");
        if (polling) {
            message('danger', "<strong>Warning!</strong> Ormerod webserver is probably broken, power cycle/reset your Duet Board :(");
            $('button#connect').text("Retrying");
        } else {
            message('info', "<strong>Disconnected</strong> Page not being updated");
            $('button#connect').text("Connect");
        }
        $('span[id$="Temp"], span[id$="pos"]').text("0");
        disableButtons("head");
        disableButtons("panic");
    } else {
        $('button#connect').removeClass('btn-danger').addClass('btn-success').text("Connected");
        //Connected Hoorahhh!
        message('hide', '');
        message('info', 'Firmware Info<br>'+status.resp );
        if (status.poll[0] === "I" && !paused) {
            //inactive, not printing
            printing = false;
            $('button#printing').removeClass('btn-danger').removeClass('btn-success').addClass('btn-warning').text("Ready :)");
            disableButtons("panic");
            enableButtons('head');
            enableButtons("gfilelist");
        } else if (status.poll[0] === "I" && paused) {
            //paused
            printing = true;
            $('button#printing').removeClass('btn-danger').removeClass('btn-success').addClass('btn-warning').text("Paused");
            enableButtons('panic');
            enableButtons('head');
        } else if (status.poll[0] === "P") {
            //printing
            printing = true;
            objHeight = $('input#objheight').val();
            $('button#printing').removeClass('btn-danger').removeClass('btn-warning').addClass('btn-success').text("Active");
            enableButtons('panic');
            disableButtons("head");
            disableButtons("gfilelist");
            currentLayer = whichLayer(status.poll[5]);
            if (isNumber(objHeight)) {
                layerCount = Math.ceil(objHeight / layerHeight);
                setProgress(Math.ceil((currentLayer / layerCount) * 100), currentLayer, layerCount);
            } else {
                setProgress(0, 0, 0);
            }
            layers(currentLayer);
        } else {
            //unknown state
            printing = paused = false;
            $('button#printing').removeClass('btn-warning').removeClass('btn-success').addClass('btn-danger').text("Error!");
        }
       
        $('span#bedTemp').text(status.poll[1]);
        $('span#headTemp').text(status.poll[2]);
        $('span#Xpos').text(status.poll[3]);
        $('span#Ypos').text(status.poll[4]);
        $('span#Zpos').text(status.poll[5]);
        $('span#Epos').text(status.poll[6]);
        $('span#probe').text(status.probe);

        //Temp chart stuff
        chartData[0].push(parseFloat(status.poll[1]));
        chartData[1].push(parseFloat(status.poll[2]));
        chart.setData(parseChartData());
        chart.draw();
    }
}

function whichLayer(currZ) {
    return Math.round(currZ / layerHeight);
}

function resetLayerData() {
    //clear layercount
    layerData = [];
    printStartTime = null;
}

function layers(layer) {
    var d = new Date();
    var utime = d.getTime();
    if (layer === 1 && !printStartTime) {
        printStartTime = utime;
    }
    if (printStartTime) {
        $('span#elapsed').text(tsToHMS(utime - printStartTime) + "s");
        layerData.push(layer, utime);
    }
    //if (printStartTime && layerData.length > 1) {
    //    $('span#lastlayer').text(tsToHMS(layerData[layerData.length-1] - layerData[layerData.length-2]) + "s");
    //}
    
}

function tsToHMS(timestamp) {
    timestamp = timestamp /1000;
    var hours = Math.round(timestamp / 3600);
    timestamp %= 3600;
    var minutes = Math.round(timestamp / 60);
    var seconds = Math.round(timestamp % 60); 
    return hours+":"+minutes+":"+seconds;
} 

function setProgress(percent, layer, layers) {
    if (layer !== 0) {
        $('span#progressText').text(percent + "% Complete, Layer " + layer + " of " + layers).attr('title', "Layer " + layer + " of " + layers);
    } else {
        $('span#progressText').text("").attr('title', "");
    }
    $('div#progress').css("width", percent + "%");
}

function parseChartData() {
    if (chartData[0].length > maxDataPoints)
        chartData[0].shift();
    if (chartData[1].length > maxDataPoints)
        chartData[1].shift();
    var res = [[], []];
    for (var i = 0; i < chartData[0].length; ++i) {
        res[0].push([i, chartData[0][i]]);
        res[1].push([i, chartData[1][i]]);
    }
    return res;
}

function poll(){
    setTimeout(function() {
        if (polling) {
            updatePage();
            poll();
        }
    }, 2000);
}

//Layer data collection
