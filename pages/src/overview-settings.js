document.addEventListener("DOMContentLoaded", (event) => {
    const sensitiveFields = document.querySelectorAll('label.login span.sensitive-data');

    sensitiveFields.forEach(field => {
        field.addEventListener('click', function(){
            field.classList.remove("sensitive-data");
        });
    });
});